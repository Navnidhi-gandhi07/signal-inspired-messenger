import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import models
from app.db import SessionLocal
import app.main as main_module
from app.main import UPLOAD, app


PNG = b'\x89PNG\r\n\x1a\n'


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def create_user(client: TestClient, username: str) -> dict:
    response = client.post(
        '/auth/register',
        json={
            'username': username,
            'password': 'test-password-123',
            'display_name': username.title(),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def auth(token: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {token}'}


def test_legacy_asgi_entry_point_reuses_supported_application():
    import main

    assert main.app is app


def test_health_endpoint_checks_database(client: TestClient):
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}


def test_production_rejects_regex_origins_before_database_setup(tmp_path: Path):
    backend_root = Path(__file__).resolve().parents[1]
    database_path = tmp_path / 'production.db'
    upload_path = tmp_path / 'uploads'
    environment = os.environ.copy()
    environment.update({
        'APP_ENV': 'production',
        'JWT_SECRET': 'production-config-test-secret-with-32-characters',
        'FRONTEND_ORIGINS': 'https://frontend.example',
        'FRONTEND_ORIGIN_REGEX': 'https://.*',
        'DATABASE_URL': f'sqlite:///{database_path.as_posix()}',
        'UPLOAD_DIR': str(upload_path),
    })
    result = subprocess.run(
        [sys.executable, '-c', 'import app.main'],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert 'FRONTEND_ORIGIN_REGEX is not allowed' in result.stderr
    assert not database_path.exists()
    assert not upload_path.exists()


def test_logout_revokes_session(client: TestClient):
    account = create_user(client, 'logout-user')
    response = client.post('/auth/logout', headers=auth(account['token']))
    assert response.status_code == 200
    assert client.get('/me', headers=auth(account['token'])).status_code == 401


def test_authenticated_upload_requires_conversation_membership(client: TestClient):
    sender = create_user(client, 'attachment-sender')
    recipient = create_user(client, 'attachment-recipient')
    stranger = create_user(client, 'attachment-stranger')
    conversation_id = client.post(
        '/conversations/direct',
        headers=auth(sender['token']),
        json={'user_id': recipient['user']['id']},
    ).json()['id']
    uploaded = client.post(
        '/upload',
        headers=auth(sender['token']),
        files={'file': ('picture.png', PNG, 'image/png')},
    )
    assert uploaded.status_code == 200, uploaded.text
    attachment = uploaded.json()
    message = client.post(
        f'/conversations/{conversation_id}/messages',
        headers=auth(sender['token']),
        json={
            'body': '',
            'kind': attachment['kind'],
            'file_url': attachment['url'],
            'file_name': attachment['name'],
        },
    )
    assert message.status_code == 200, message.text
    assert client.get(attachment['url'], headers=auth(recipient['token'])).content == PNG
    assert client.get(attachment['url'], headers=auth(stranger['token'])).status_code == 403


def test_upload_rejects_mismatched_content_and_avatar_is_saved(client: TestClient):
    account = create_user(client, 'avatar-user')
    invalid = client.post(
        '/upload',
        headers=auth(account['token']),
        files={'file': ('fake.png', b'not a png', 'image/png')},
    )
    assert invalid.status_code == 400
    uploaded = client.post(
        '/profile/avatar',
        headers=auth(account['token']),
        files={'file': ('avatar.png', PNG, 'image/png')},
    )
    assert uploaded.status_code == 200, uploaded.text
    avatar_url = uploaded.json()['avatar']
    assert avatar_url.startswith('/avatars/')
    assert client.get(avatar_url).content == PNG


def test_websocket_auth_typing_and_live_message_delivery(client: TestClient):
    sender = create_user(client, 'socket-sender')
    receiver = create_user(client, 'socket-receiver')
    conversation_id = client.post(
        '/conversations/direct',
        headers=auth(sender['token']),
        json={'user_id': receiver['user']['id']},
    ).json()['id']

    with client.websocket_connect('/ws') as sender_socket:
        sender_socket.send_json({'type': 'auth', 'token': sender['token']})
        assert sender_socket.receive_json()['type'] == 'ready'
        with client.websocket_connect('/ws') as receiver_socket:
            receiver_socket.send_json({'type': 'auth', 'token': receiver['token']})
            assert receiver_socket.receive_json()['type'] == 'ready'
            sender_socket.send_json({
                'type': 'typing',
                'conversation_id': conversation_id,
                'active': True,
            })
            typing = receiver_socket.receive_json()
            assert typing == {
                'type': 'typing',
                'conversation_id': conversation_id,
                'user_id': sender['user']['id'],
                'active': True,
            }
            response = client.post(
                f'/conversations/{conversation_id}/messages',
                headers=auth(sender['token']),
                json={'body': 'Realtime and timestamp check'},
            )
            assert response.status_code == 200
            delivered = receiver_socket.receive_json()
            assert delivered['type'] == 'message'
            assert delivered['message']['body'] == 'Realtime and timestamp check'
            assert delivered['message']['created_at'].endswith('Z')


def test_websocket_rejects_invalid_initial_authentication(client: TestClient):
    with client.websocket_connect('/ws') as websocket:
        websocket.send_json({'type': 'auth', 'token': 'invalid-token'})
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_websocket_rejects_unconfigured_browser_origin(client: TestClient):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            '/ws',
            headers={'origin': 'https://untrusted.example'},
        ):
            pass


def test_websocket_accepts_configured_browser_origin(client: TestClient, monkeypatch):
    account = create_user(client, 'allowed-origin-user')
    monkeypatch.setattr(main_module, 'FRONTEND_ORIGINS', ['https://frontend.example'])
    monkeypatch.setattr(main_module, 'FRONTEND_ORIGIN_PATTERN', None)
    with client.websocket_connect(
        '/ws',
        headers={'origin': 'https://frontend.example'},
    ) as websocket:
        websocket.send_json({'type': 'auth', 'token': account['token']})
        assert websocket.receive_json()['type'] == 'ready'


def test_group_member_permissions_duplicate_add_and_removal(client: TestClient):
    admin = create_user(client, 'group-admin')
    member = create_user(client, 'group-member')
    invitee = create_user(client, 'group-invitee')
    group_id = client.post(
        '/conversations/group',
        headers=auth(admin['token']),
        json={'name': 'Test group', 'member_ids': [member['user']['id']]},
    ).json()['id']
    add_url = f'/conversations/{group_id}/members'
    forbidden = client.post(
        add_url,
        headers=auth(member['token']),
        json={'user_id': invitee['user']['id']},
    )
    assert forbidden.status_code == 403

    for _ in range(2):
        added = client.post(
            add_url,
            headers=auth(admin['token']),
            json={'user_id': invitee['user']['id']},
        )
        assert added.status_code == 200
    members = client.get(add_url, headers=auth(admin['token'])).json()
    assert sum(person['id'] == invitee['user']['id'] for person in members) == 1
    admin_leave = client.delete(
        f'{add_url}/{admin["user"]["id"]}',
        headers=auth(admin['token']),
    )
    assert admin_leave.status_code == 400

    removed = client.delete(
        f'{add_url}/{invitee["user"]["id"]}',
        headers=auth(admin['token']),
    )
    assert removed.status_code == 200
    assert client.get(
        f'/conversations/{group_id}/messages',
        headers=auth(invitee['token']),
    ).status_code == 403

    direct_id = client.post(
        '/conversations/direct',
        headers=auth(admin['token']),
        json={'user_id': invitee['user']['id']},
    ).json()['id']
    direct_leave = client.delete(
        f'/conversations/{direct_id}/members/{admin["user"]["id"]}',
        headers=auth(admin['token']),
    )
    assert direct_leave.status_code == 400


def test_expired_attachment_is_removed_from_database_and_disk(client: TestClient):
    sender = create_user(client, 'expiry-sender')
    recipient = create_user(client, 'expiry-recipient')
    conversation_id = client.post(
        '/conversations/direct',
        headers=auth(sender['token']),
        json={'user_id': recipient['user']['id']},
    ).json()['id']
    upload = client.post(
        '/upload',
        headers=auth(sender['token']),
        files={'file': ('expire.png', PNG, 'image/png')},
    ).json()
    sent = client.post(
        f'/conversations/{conversation_id}/messages',
        headers=auth(sender['token']),
        json={'body': '', 'kind': 'image', 'file_url': upload['url'], 'file_name': upload['name']},
    )
    assert sent.status_code == 200, sent.text
    filename = upload['url'].rsplit('/', 1)[-1]
    assert (UPLOAD / filename).is_file()
    with SessionLocal() as db:
        message = db.get(models.Message, sent.json()['id'])
        message.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
        db.commit()

    listed = client.get(
        f'/conversations/{conversation_id}/messages',
        headers=auth(recipient['token']),
    )
    assert listed.status_code == 200
    assert all(message['id'] != sent.json()['id'] for message in listed.json())
    assert not (UPLOAD / filename).exists()
