from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, Text
from datetime import datetime, timezone
from .db import Base
def now(): return datetime.now(timezone.utc)
class User(Base):
 __tablename__='users'
 id=Column(Integer,primary_key=True); username=Column(String(80),unique=True,nullable=False); display_name=Column(String(120),nullable=False); avatar=Column(String(500),default=''); about=Column(String(250),default=''); password_hash=Column(String(300),nullable=False); online=Column(Boolean,default=False); last_seen=Column(DateTime,default=now)
class Contact(Base):
 __tablename__='contacts'; id=Column(Integer,primary_key=True); owner_id=Column(Integer,ForeignKey('users.id')); contact_id=Column(Integer,ForeignKey('users.id')); __table_args__=(UniqueConstraint('owner_id','contact_id'),)
class Conversation(Base):
 __tablename__='conversations'; id=Column(Integer,primary_key=True); name=Column(String(120),default=''); is_group=Column(Boolean,default=False); avatar=Column(String(500),default=''); created_by=Column(Integer,ForeignKey('users.id')); created_at=Column(DateTime,default=now); disappearing_seconds=Column(Integer,default=0)
class Member(Base):
 __tablename__='members'; id=Column(Integer,primary_key=True); conversation_id=Column(Integer,ForeignKey('conversations.id')); user_id=Column(Integer,ForeignKey('users.id')); is_admin=Column(Boolean,default=False); last_read_id=Column(Integer,default=0); __table_args__=(UniqueConstraint('conversation_id','user_id'),)
class Message(Base):
 __tablename__='messages'; id=Column(Integer,primary_key=True); conversation_id=Column(Integer,ForeignKey('conversations.id')); sender_id=Column(Integer,ForeignKey('users.id')); body=Column(Text,default=''); kind=Column(String(20),default='text'); file_url=Column(String(500),default=''); file_name=Column(String(250),default=''); reply_to_id=Column(Integer,ForeignKey('messages.id'),nullable=True); created_at=Column(DateTime,default=now); expires_at=Column(DateTime,nullable=True)
class Receipt(Base):
 __tablename__='receipts'; id=Column(Integer,primary_key=True); message_id=Column(Integer,ForeignKey('messages.id')); user_id=Column(Integer,ForeignKey('users.id')); status=Column(String(20),default='delivered'); __table_args__=(UniqueConstraint('message_id','user_id'),)
class Reaction(Base):
 __tablename__='reactions'; id=Column(Integer,primary_key=True); message_id=Column(Integer,ForeignKey('messages.id')); user_id=Column(Integer,ForeignKey('users.id')); emoji=Column(String(12)); __table_args__=(UniqueConstraint('message_id','user_id'),)
class Setting(Base):
 __tablename__='settings'; id=Column(Integer,primary_key=True); user_id=Column(Integer,ForeignKey('users.id'),unique=True); theme=Column(String(12),default='light'); read_receipts=Column(Boolean,default=True); typing_indicators=Column(Boolean,default=True); notifications=Column(Boolean,default=True)
class RevokedToken(Base):
 __tablename__='revoked_tokens'; id=Column(Integer,primary_key=True); jti=Column(String(100),unique=True,nullable=False); expires_at=Column(DateTime,nullable=False)
class UploadedFile(Base):
 __tablename__='uploaded_files'; id=Column(Integer,primary_key=True); filename=Column(String(100),unique=True,nullable=False); owner_id=Column(Integer,ForeignKey('users.id'),nullable=False); mime_type=Column(String(100),nullable=False); is_avatar=Column(Boolean,default=False); created_at=Column(DateTime,default=now)
