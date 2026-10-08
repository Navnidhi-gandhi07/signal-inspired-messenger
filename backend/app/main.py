import asyncio, hashlib, hmac, logging, os, re, secrets, time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from collections import defaultdict
from typing import Pattern
import jwt
from fastapi import FastAPI, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_, text
from sqlalchemy.exc import SQLAlchemyError
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .db import Base, engine, get_db, SessionLocal
from . import models as m
APP_ENV=os.getenv('APP_ENV','development').lower()
SECRET=os.getenv('JWT_SECRET')
FRONTEND_ORIGINS=[origin.strip().rstrip('/') for origin in os.getenv('FRONTEND_ORIGINS','http://localhost:3000').split(',') if origin.strip()]
FRONTEND_ORIGIN_REGEX=os.getenv('FRONTEND_ORIGIN_REGEX','').strip()
if APP_ENV in ('production','prod'):
 if not SECRET or len(SECRET)<32:
  raise RuntimeError('A JWT_SECRET of at least 32 characters must be configured in production')
 if FRONTEND_ORIGIN_REGEX:
  raise RuntimeError('Set production frontend domains explicitly in FRONTEND_ORIGINS; FRONTEND_ORIGIN_REGEX is not allowed')
 if not FRONTEND_ORIGINS:
  raise RuntimeError('FRONTEND_ORIGINS must contain the deployed HTTPS frontend origin')
 if any(not origin.startswith('https://') for origin in FRONTEND_ORIGINS):
  raise RuntimeError('Production FRONTEND_ORIGINS values must use HTTPS')
SECRET=SECRET or 'local-development-only-not-for-production'
ALGO='HS256'
try:
 FRONTEND_ORIGIN_PATTERN:Pattern[str]|None=re.compile(FRONTEND_ORIGIN_REGEX) if FRONTEND_ORIGIN_REGEX else None
except re.error as exc:
 raise RuntimeError('FRONTEND_ORIGIN_REGEX is not a valid regular expression') from exc
Base.metadata.create_all(bind=engine)
@asynccontextmanager
async def lifespan(_:FastAPI):
 with SessionLocal() as db: cleanup_expired(db)
 cleanup_task=asyncio.create_task(expiry_cleanup_loop())
 try:
  yield
 finally:
  cleanup_task.cancel()
  try: await cleanup_task
  except asyncio.CancelledError: pass

app=FastAPI(title='Signal-inspired Messenger API',lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=FRONTEND_ORIGINS,allow_origin_regex=FRONTEND_ORIGIN_REGEX or None,allow_credentials=True,allow_methods=['*'],allow_headers=['*'])
UPLOAD=Path(os.getenv('UPLOAD_DIR','uploads')).resolve(); UPLOAD.mkdir(parents=True,exist_ok=True)
class Auth(BaseModel): username:str=Field(min_length=3,max_length=80); password:str=Field(min_length=6)
class Register(Auth): display_name:str=Field(min_length=1,max_length=120)
class Profile(BaseModel): display_name:str|None=Field(default=None,min_length=1,max_length=120); about:str|None=Field(default=None,max_length=250)
class ContactIn(BaseModel): username:str
class ChatIn(BaseModel): user_id:int
class GroupIn(BaseModel): name:str=Field(min_length=1,max_length=120); member_ids:list[int]
class TextIn(BaseModel): body:str=Field(default='',max_length=10000); reply_to_id:int|None=None; kind:str='text'; file_url:str=''; file_name:str=Field(default='',max_length=250)
class ReactionIn(BaseModel): emoji:str=Field(min_length=1,max_length=12)
class TimerIn(BaseModel): seconds:int=Field(ge=0,le=2592000)
class SettingsIn(BaseModel): theme:str|None=None; read_receipts:bool|None=None; typing_indicators:bool|None=None; notifications:bool|None=None
class MemberIn(BaseModel): user_id:int
connections:dict[int,set[WebSocket]]=defaultdict(set)
login_attempts:dict[str,list[float]]=defaultdict(list)
logger=logging.getLogger(__name__)
MAX_UPLOAD_SIZE=10*1024*1024
MAX_AVATAR_SIZE=5*1024*1024
UPLOAD_TYPES={
 'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp',
 'application/pdf':'.pdf','text/plain':'.txt','application/zip':'.zip'
}
bearer=HTTPBearer()
def utc_naive(): return datetime.now(timezone.utc).replace(tzinfo=None)
def iso_utc(value):
 if value.tzinfo is None: value=value.replace(tzinfo=timezone.utc)
 return value.astimezone(timezone.utc).isoformat().replace('+00:00','Z')
def uploaded_path(filename):
 candidate=(UPLOAD/filename).resolve()
 if candidate.parent!=UPLOAD: raise HTTPException(400,'Invalid file path')
 return candidate
def validate_upload(content,declared_type):
 if declared_type not in UPLOAD_TYPES: raise HTTPException(400,'Unsupported file type')
 signatures={
  'image/png':content.startswith(b'\x89PNG\r\n\x1a\n'),
  'image/jpeg':content.startswith(b'\xff\xd8\xff'),
  'image/gif':content.startswith((b'GIF87a',b'GIF89a')),
  'image/webp':len(content)>=12 and content[:4]==b'RIFF' and content[8:12]==b'WEBP',
  'application/pdf':content.startswith(b'%PDF-'),
  'text/plain':b'\x00' not in content,
  'application/zip':content.startswith((b'PK\x03\x04',b'PK\x05\x06',b'PK\x07\x08')),
 }
 if not signatures[declared_type]: raise HTTPException(400,'File content does not match the selected file type')
 if declared_type=='text/plain':
  try: content.decode('utf-8')
  except UnicodeDecodeError as exc: raise HTTPException(400,'Text attachments must be UTF-8') from exc
def safe_upload_name(raw):
 name=Path((raw or 'attachment').replace('\\','/')).name
 name=''.join(ch for ch in name if ch.isprintable() and ch not in '/\\')
 return (name[:120] or 'attachment')
def password_hash(p):
 salt=secrets.token_hex(16); return salt+':'+hashlib.pbkdf2_hmac('sha256',p.encode(),bytes.fromhex(salt),180000).hex()
def check_password(p,h):
 try:
  salt,digest=h.split(':'); return hmac.compare_digest(hashlib.pbkdf2_hmac('sha256',p.encode(),bytes.fromhex(salt),180000).hex(),digest)
 except Exception: return False
def token(u): return jwt.encode({'sub':str(u.id),'jti':secrets.token_urlsafe(18),'exp':datetime.now(timezone.utc)+timedelta(hours=12)},SECRET,algorithm=ALGO)
def identity(raw,db):
 try:
  claims=jwt.decode(raw,SECRET,algorithms=[ALGO]);uid=int(claims['sub'])
 except Exception: raise HTTPException(401,'Invalid session')
 if claims.get('jti') and db.query(m.RevokedToken).filter_by(jti=claims['jti']).first(): raise HTTPException(401,'Session has been revoked')
 u=db.get(m.User,uid)
 if not u: raise HTTPException(401,'User not found')
 return u
def current(creds:HTTPAuthorizationCredentials=Depends(bearer),db:Session=Depends(get_db)): return identity(creds.credentials,db)
def user_json(u): return {'id':u.id,'username':u.username,'display_name':u.display_name,'avatar':u.avatar,'about':u.about,'online':u.online}
def member_ids(db,cid): return [x.user_id for x in db.query(m.Member).filter_by(conversation_id=cid).all()]
def require_member(db,cid,uid):
 member=db.query(m.Member).filter_by(conversation_id=cid,user_id=uid).first()
 if not member: raise HTTPException(403,'Not a conversation member')
 return member
def message_json(db,msg):
 reactions=db.query(m.Reaction).filter_by(message_id=msg.id).all(); receipts=db.query(m.Receipt).filter_by(message_id=msg.id).all()
 return {'id':msg.id,'conversation_id':msg.conversation_id,'sender_id':msg.sender_id,'sender':user_json(db.get(m.User,msg.sender_id)),'body':msg.body,'kind':msg.kind,'file_url':msg.file_url,'file_name':msg.file_name,'reply_to_id':msg.reply_to_id,'created_at':iso_utc(msg.created_at),'expires_at':iso_utc(msg.expires_at) if msg.expires_at else None,'reactions':[{'user_id':r.user_id,'emoji':r.emoji} for r in reactions],'receipts':[{'user_id':r.user_id,'status':r.status} for r in receipts]}
def cleanup_expired(db):
 now=utc_naive()
 db.query(m.RevokedToken).filter(m.RevokedToken.expires_at<=now).delete(synchronize_session=False)
 expired=db.query(m.Message).filter(m.Message.expires_at.isnot(None),m.Message.expires_at<=now).all()
 filenames=set()
 for message in expired:
  if message.file_url.startswith('/uploads/'):
   filenames.add(message.file_url.rsplit('/',1)[-1])
  db.query(m.Reaction).filter_by(message_id=message.id).delete(synchronize_session=False)
  db.query(m.Receipt).filter_by(message_id=message.id).delete(synchronize_session=False)
  db.delete(message)
 if expired:
  db.commit()
  for filename in filenames:
   active_reference=db.query(m.Message.id).filter(
    m.Message.file_url==f'/uploads/{filename}',
    (m.Message.expires_at.is_(None)) | (m.Message.expires_at>now),
   ).first()
   if active_reference: continue
   try: uploaded_path(filename).unlink(missing_ok=True)
   except OSError: logger.exception('Could not remove expired attachment %s',filename)
   db.query(m.UploadedFile).filter_by(filename=filename).delete(synchronize_session=False)
  db.commit()

async def expiry_cleanup_loop():
 while True:
  await asyncio.sleep(30)
  try:
   with SessionLocal() as db: cleanup_expired(db)
  except Exception:
   logger.exception('Periodic disappearing-message cleanup failed')

async def emit(ids,event):
 for uid in ids:
  for ws in list(connections.get(uid,[])):
   try: await ws.send_json(event)
   except Exception: connections[uid].discard(ws)
def origin_allowed(origin):
 return origin in FRONTEND_ORIGINS or bool(FRONTEND_ORIGIN_PATTERN and FRONTEND_ORIGIN_PATTERN.fullmatch(origin))
@app.get('/health')
def health(db:Session=Depends(get_db)):
 try:
  db.execute(text('SELECT 1'))
 except SQLAlchemyError:
  logger.exception('Health check could not reach the database')
  raise HTTPException(503,'Database unavailable')
 return {'status':'ok'}
@app.post('/auth/register')
def register(data:Register,db:Session=Depends(get_db)):
 if db.query(m.User).filter_by(username=data.username.lower()).first(): raise HTTPException(409,'Username taken')
 u=m.User(username=data.username.lower(),display_name=data.display_name,password_hash=password_hash(data.password));db.add(u);db.flush();db.add(m.Setting(user_id=u.id));db.commit();return {'token':token(u),'user':user_json(u)}
@app.post('/auth/login')
def login(data:Auth,request:Request,db:Session=Depends(get_db)):
 client=request.client.host if request.client else 'unknown'
 key=f'{client}:{data.username.lower()}'
 now=time.monotonic()
 login_attempts[key]=[attempt for attempt in login_attempts[key] if now-attempt<300]
 if len(login_attempts[key])>=5: raise HTTPException(429,'Too many sign-in attempts. Try again in five minutes.')
 u=db.query(m.User).filter_by(username=data.username.lower()).first()
 if not u or not check_password(data.password,u.password_hash):
  login_attempts[key].append(now)
  raise HTTPException(401,'Invalid credentials')
 login_attempts.pop(key,None)
 return {'token':token(u),'user':user_json(u)}
@app.post('/auth/logout')
def logout(creds:HTTPAuthorizationCredentials=Depends(bearer),u:m.User=Depends(current),db:Session=Depends(get_db)):
 claims=jwt.decode(creds.credentials,SECRET,algorithms=[ALGO])
 jti=claims.get('jti')
 if jti and not db.query(m.RevokedToken).filter_by(jti=jti).first():
  expiry=datetime.fromtimestamp(claims['exp'],timezone.utc).replace(tzinfo=None)
  db.add(m.RevokedToken(jti=jti,expires_at=expiry));db.commit()
 return {'ok':True}
@app.get('/me')
def get_me(u:m.User=Depends(current)): return user_json(u)
@app.patch('/me')
def patch_me(data:Profile,u:m.User=Depends(current),db:Session=Depends(get_db)):
 for key,value in data.model_dump(exclude_none=True).items(): setattr(u,key,value)
 db.commit();return user_json(u)
@app.post('/profile/avatar')
async def update_avatar(file:UploadFile=File(...),u:m.User=Depends(current),db:Session=Depends(get_db)):
 content=await file.read(MAX_AVATAR_SIZE+1)
 if len(content)>MAX_AVATAR_SIZE: raise HTTPException(413,'Profile photos must be 5 MB or smaller')
 if file.content_type not in ('image/png','image/jpeg','image/gif','image/webp'): raise HTTPException(400,'Unsupported profile photo type')
 validate_upload(content,file.content_type)
 old_avatar=u.avatar
 filename=secrets.token_hex(24)+UPLOAD_TYPES[file.content_type]
 uploaded_path(filename).write_bytes(content)
 db.add(m.UploadedFile(filename=filename,owner_id=u.id,mime_type=file.content_type,is_avatar=True))
 u.avatar=f'/avatars/{filename}'
 db.commit()
 if old_avatar.startswith('/avatars/'):
  old_filename=old_avatar.rsplit('/',1)[-1]
  if old_filename!=filename:
   try: uploaded_path(old_filename).unlink(missing_ok=True)
   except OSError: logger.exception('Could not remove replaced avatar %s',old_filename)
   db.query(m.UploadedFile).filter_by(filename=old_filename,owner_id=u.id,is_avatar=True).delete(synchronize_session=False);db.commit()
 return user_json(u)
@app.get('/avatars/{filename}')
def get_avatar(filename:str,db:Session=Depends(get_db)):
 if not re.fullmatch(r'[a-f0-9]{48}\.(png|jpg|gif|webp)',filename): raise HTTPException(404,'Avatar not found')
 asset=db.query(m.UploadedFile).filter_by(filename=filename,is_avatar=True).first()
 path=uploaded_path(filename)
 if not asset or not path.is_file(): raise HTTPException(404,'Avatar not found')
 return FileResponse(path,media_type=asset.mime_type,headers={'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=300'})
@app.get('/users')
def users(q:str='',u:m.User=Depends(current),db:Session=Depends(get_db)):
 return [user_json(x) for x in db.query(m.User).filter(m.User.id!=u.id,or_(m.User.display_name.ilike(f'%{q}%'),m.User.username.ilike(f'%{q}%'))).limit(40)]
@app.get('/contacts')
def contacts(u:m.User=Depends(current),db:Session=Depends(get_db)):
 return [user_json(db.get(m.User,x.contact_id)) for x in db.query(m.Contact).filter_by(owner_id=u.id)]
@app.post('/contacts')
def add_contact(data:ContactIn,u:m.User=Depends(current),db:Session=Depends(get_db)):
 other=db.query(m.User).filter_by(username=data.username.lower()).first()
 if not other or other.id==u.id: raise HTTPException(404,'Contact not found')
 if not db.query(m.Contact).filter_by(owner_id=u.id,contact_id=other.id).first(): db.add(m.Contact(owner_id=u.id,contact_id=other.id));db.commit()
 return user_json(other)
@app.get('/conversations')
def conversations(u:m.User=Depends(current),db:Session=Depends(get_db)):
 cleanup_expired(db)
 memberships=db.query(m.Member).filter_by(user_id=u.id).all();result=[]
 for membership in memberships:
  c=db.get(m.Conversation,membership.conversation_id);ids=member_ids(db,c.id);other=db.get(m.User,next((i for i in ids if i!=u.id),u.id))
  latest=db.query(m.Message).filter_by(conversation_id=c.id).filter(or_(m.Message.expires_at==None,m.Message.expires_at>utc_naive())).order_by(m.Message.id.desc()).first()
  unread=db.query(m.Message).filter(m.Message.conversation_id==c.id,m.Message.id>membership.last_read_id,m.Message.sender_id!=u.id,or_(m.Message.expires_at==None,m.Message.expires_at>utc_naive())).count()
  result.append({'id':c.id,'name':c.name if c.is_group else other.display_name,'avatar':c.avatar if c.is_group else other.avatar,'is_group':c.is_group,'member_ids':ids,'other':user_json(other),'last_message':message_json(db,latest) if latest else None,'unread':unread,'disappearing_seconds':c.disappearing_seconds})
 return sorted(result,key=lambda x:x['last_message']['id'] if x['last_message'] else 0,reverse=True)
@app.post('/conversations/direct')
def direct(data:ChatIn,u:m.User=Depends(current),db:Session=Depends(get_db)):
 if not db.get(m.User,data.user_id) or data.user_id==u.id: raise HTTPException(400,'Invalid user')
 mine={x.conversation_id for x in db.query(m.Member).filter_by(user_id=u.id)}
 for cid in mine:
  c=db.get(m.Conversation,cid)
  if not c.is_group and set(member_ids(db,cid))=={u.id,data.user_id}: return {'id':cid}
 c=m.Conversation(created_by=u.id);db.add(c);db.flush();db.add_all([m.Member(conversation_id=c.id,user_id=i,is_admin=i==u.id) for i in (u.id,data.user_id)]);db.commit();return {'id':c.id}
@app.post('/conversations/group')
def group(data:GroupIn,u:m.User=Depends(current),db:Session=Depends(get_db)):
 ids=set(data.member_ids)|{u.id}
 if len(ids)<2 or any(not db.get(m.User,i) for i in ids): raise HTTPException(400,'Invalid members')
 c=m.Conversation(name=data.name,is_group=True,created_by=u.id);db.add(c);db.flush();db.add_all([m.Member(conversation_id=c.id,user_id=i,is_admin=i==u.id) for i in ids]);db.commit();return {'id':c.id}
@app.get('/conversations/{cid}/members')
def members(cid:int,u:m.User=Depends(current),db:Session=Depends(get_db)):
 require_member(db,cid,u.id);return [{**user_json(db.get(m.User,x.user_id)),'is_admin':x.is_admin} for x in db.query(m.Member).filter_by(conversation_id=cid)]
@app.post('/conversations/{cid}/members')
async def add_member(cid:int,data:MemberIn,u:m.User=Depends(current),db:Session=Depends(get_db)):
 member=require_member(db,cid,u.id);c=db.get(m.Conversation,cid)
 if not c.is_group or not member.is_admin: raise HTTPException(403,'Admin only')
 if not db.get(m.User,data.user_id): raise HTTPException(404,'User missing')
 if data.user_id not in member_ids(db,cid): db.add(m.Member(conversation_id=cid,user_id=data.user_id));db.commit()
 await emit(member_ids(db,cid),{'type':'conversation_changed'});return {'ok':True}
@app.delete('/conversations/{cid}/members/{uid}')
async def remove_member(cid:int,uid:int,u:m.User=Depends(current),db:Session=Depends(get_db)):
 member=require_member(db,cid,u.id)
 c=db.get(m.Conversation,cid)
 if not c or not c.is_group: raise HTTPException(400,'Members can only be removed from group conversations')
 if member.is_admin and uid==u.id: raise HTTPException(400,'Transfer group administration before leaving')
 if not member.is_admin and uid!=u.id: raise HTTPException(403,'Admin only')
 target=db.query(m.Member).filter_by(conversation_id=cid,user_id=uid).first()
 if not target: raise HTTPException(404,'Member missing')
 db.delete(target);db.commit();await emit(member_ids(db,cid)+[uid],{'type':'conversation_changed'});return {'ok':True}
@app.get('/conversations/{cid}/messages')
def messages(cid:int,u:m.User=Depends(current),db:Session=Depends(get_db)):
 cleanup_expired(db)
 require_member(db,cid,u.id);rows=db.query(m.Message).filter(m.Message.conversation_id==cid,or_(m.Message.expires_at==None,m.Message.expires_at>utc_naive())).order_by(m.Message.id.desc()).limit(200).all();return [message_json(db,x) for x in reversed(rows)]
@app.post('/conversations/{cid}/messages')
async def send(cid:int,data:TextIn,u:m.User=Depends(current),db:Session=Depends(get_db)):
 require_member(db,cid,u.id);c=db.get(m.Conversation,cid)
 if not data.body.strip() and not data.file_url: raise HTTPException(400,'Empty message')
 if data.file_url:
  if not data.file_url.startswith('/uploads/') or '/' in data.file_url.removeprefix('/uploads/'): raise HTTPException(400,'Invalid attachment reference')
  filename=data.file_url.rsplit('/',1)[-1]
  asset=db.query(m.UploadedFile).filter_by(filename=filename,owner_id=u.id,is_avatar=False).first()
  if not asset or not uploaded_path(filename).is_file(): raise HTTPException(403,'Attachment upload is not available to this account')
  if data.kind not in ('image','file'): raise HTTPException(400,'Invalid attachment kind')
 if not data.file_url and data.kind!='text': raise HTTPException(400,'Invalid message kind')
 if data.reply_to_id:
  parent=db.get(m.Message,data.reply_to_id)
  if not parent or parent.conversation_id!=cid: raise HTTPException(400,'Invalid reply')
 expiry=utc_naive()+timedelta(seconds=c.disappearing_seconds) if c.disappearing_seconds else None
 msg=m.Message(conversation_id=cid,sender_id=u.id,body=data.body,reply_to_id=data.reply_to_id,kind=data.kind,file_url=data.file_url,file_name=data.file_name,expires_at=expiry);db.add(msg);db.flush()
 for uid in member_ids(db,cid):
  if uid!=u.id: db.add(m.Receipt(message_id=msg.id,user_id=uid,status='delivered' if connections.get(uid) else 'sent'))
 db.commit();result=message_json(db,msg);await emit(member_ids(db,cid),{'type':'message','message':result});return result
@app.post('/conversations/{cid}/read')
async def read(cid:int,u:m.User=Depends(current),db:Session=Depends(get_db)):
 membership=require_member(db,cid,u.id);latest=db.query(m.Message).filter_by(conversation_id=cid).order_by(m.Message.id.desc()).first()
 if latest:
  membership.last_read_id=latest.id
  setting=db.query(m.Setting).filter_by(user_id=u.id).first()
  if not setting or setting.read_receipts:
   for receipt in db.query(m.Receipt).join(m.Message,m.Receipt.message_id==m.Message.id).filter(m.Message.conversation_id==cid,m.Receipt.user_id==u.id): receipt.status='read'
  db.commit()
  if not setting or setting.read_receipts: await emit(member_ids(db,cid),{'type':'read','conversation_id':cid,'user_id':u.id})
 return {'ok':True}
@app.post('/messages/{mid}/reactions')
async def react(mid:int,data:ReactionIn,u:m.User=Depends(current),db:Session=Depends(get_db)):
 msg=db.get(m.Message,mid)
 if not msg: raise HTTPException(404,'Message missing')
 require_member(db,msg.conversation_id,u.id)
 reaction=db.query(m.Reaction).filter_by(message_id=mid,user_id=u.id).first()
 if reaction: reaction.emoji=data.emoji
 else: db.add(m.Reaction(message_id=mid,user_id=u.id,emoji=data.emoji))
 db.commit();await emit(member_ids(db,msg.conversation_id),{'type':'reaction','conversation_id':msg.conversation_id});return {'ok':True}
@app.patch('/conversations/{cid}/timer')
async def timer_set(cid:int,data:TimerIn,u:m.User=Depends(current),db:Session=Depends(get_db)):
 require_member(db,cid,u.id);c=db.get(m.Conversation,cid);c.disappearing_seconds=data.seconds;db.commit();await emit(member_ids(db,cid),{'type':'conversation_changed'});return {'seconds':c.disappearing_seconds}
@app.get('/settings')
def settings(u:m.User=Depends(current),db:Session=Depends(get_db)):
 s=db.query(m.Setting).filter_by(user_id=u.id).first();return {k:getattr(s,k) for k in ('theme','read_receipts','typing_indicators','notifications')}
@app.patch('/settings')
def update_settings(data:SettingsIn,u:m.User=Depends(current),db:Session=Depends(get_db)):
 s=db.query(m.Setting).filter_by(user_id=u.id).first()
 for k,v in data.model_dump(exclude_none=True).items():
  if k=='theme' and v not in ('light','dark','system'): raise HTTPException(400,'Invalid theme')
  setattr(s,k,v)
 db.commit();return settings(u,db)
@app.post('/upload')
async def upload(file:UploadFile=File(...),u:m.User=Depends(current)):
 content=await file.read(MAX_UPLOAD_SIZE+1)
 if len(content)>MAX_UPLOAD_SIZE: raise HTTPException(413,'Max file size 10MB')
 validate_upload(content,file.content_type or '')
 suffix=UPLOAD_TYPES[file.content_type]
 name=secrets.token_hex(24)+suffix
 uploaded_path(name).write_bytes(content)
 with SessionLocal() as db:
  db.add(m.UploadedFile(filename=name,owner_id=u.id,mime_type=file.content_type,is_avatar=False));db.commit()
 return {'url':'/uploads/'+name,'name':safe_upload_name(file.filename or 'attachment'),'kind':'image' if file.content_type.startswith('image/') else 'file'}
@app.get('/uploads/{filename}')
def download_upload(filename:str,u:m.User=Depends(current),db:Session=Depends(get_db)):
 cleanup_expired(db)
 if not re.fullmatch(r'[a-f0-9]{48}\.(png|jpg|gif|webp|pdf|txt|zip)',filename): raise HTTPException(404,'File not found')
 url=f'/uploads/{filename}'
 message=db.query(m.Message).filter_by(file_url=url).first()
 if not message: raise HTTPException(404,'File not found')
 require_member(db,message.conversation_id,u.id)
 asset=db.query(m.UploadedFile).filter_by(filename=filename,is_avatar=False).first()
 path=uploaded_path(filename)
 if not path.is_file(): raise HTTPException(404,'File not found')
 media_type=asset.mime_type if asset else 'application/octet-stream'
 return FileResponse(path,media_type=media_type,headers={'X-Content-Type-Options':'nosniff','Content-Disposition':f'inline; filename="{filename}"','Cache-Control':'private, no-store'})
@app.websocket('/ws')
async def websocket(ws:WebSocket):
 origin=ws.headers.get('origin')
 if origin and not origin_allowed(origin):
  await ws.close(code=1008)
  return
 await ws.accept()
 try:
  auth=await asyncio.wait_for(ws.receive_json(),timeout=5)
  if not isinstance(auth,dict) or auth.get('type')!='auth' or not isinstance(auth.get('token'),str): raise HTTPException(401,'Authentication required')
  with SessionLocal() as db: u=identity(auth['token'],db);uid=u.id
 except (asyncio.TimeoutError,HTTPException):
  await ws.close(code=1008);return
 with SessionLocal() as db:
  u=db.get(m.User,uid);u.online=True;db.commit()
 connections[uid].add(ws)
 await ws.send_json({'type':'ready'})
 try:
  while True:
   event=await ws.receive_json()
   if isinstance(event,dict) and event.get('type')=='typing':
    try: cid=int(event.get('conversation_id',0))
    except (TypeError,ValueError): continue
    active=event.get('active') is True
    with SessionLocal() as db:
     setting=db.query(m.Setting).filter_by(user_id=uid).first()
     if db.query(m.Member).filter_by(conversation_id=cid,user_id=uid).first() and (not setting or setting.typing_indicators):
      await emit([i for i in member_ids(db,cid) if i!=uid],{'type':'typing','conversation_id':cid,'user_id':uid,'active':active})
 except WebSocketDisconnect: pass
 finally:
  connections[uid].discard(ws)
  with SessionLocal() as db:
   for membership in db.query(m.Member).filter_by(user_id=uid).all():
    await emit([i for i in member_ids(db,membership.conversation_id) if i!=uid],{'type':'typing','conversation_id':membership.conversation_id,'user_id':uid,'active':False})
  if not connections[uid]:
   with SessionLocal() as db:
    u=db.get(m.User,uid)
    if u: u.online=False;u.last_seen=utc_naive();db.commit()
