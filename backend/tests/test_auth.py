from app.main import password_hash,check_password
def test_password_hash():
 h=password_hash('sample123');assert check_password('sample123',h);assert not check_password('wrong',h)
