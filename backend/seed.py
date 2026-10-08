from app.db import Base,engine,SessionLocal
from app.models import User,Setting,Conversation,Member,Message,Contact
from app.main import password_hash
Base.metadata.create_all(engine)
with SessionLocal() as db:
 if db.query(User).count(): print('Existing data preserved');quit()
 names=['Alex Morgan','Priya Sharma','Ankit Verma','Neha Kapoor','Rahul Mehta','Sara Khan']
 users=[]
 for name in names:
  u=User(username=name.lower().replace(' ',''),display_name=name,password_hash=password_hash('demo1234'));db.add(u);db.flush();db.add(Setting(user_id=u.id));users.append(u)
 for other in users[1:]: db.add(Contact(owner_id=users[0].id,contact_id=other.id))
 for i,other in enumerate(users[1:]):
  c=Conversation(created_by=users[0].id);db.add(c);db.flush();db.add_all([Member(conversation_id=c.id,user_id=x.id,is_admin=x.id==users[0].id) for x in (users[0],other)])
  for sender,body in [(other,'Hey! How are you doing?'),(users[0],'Doing great! What about you?'),(other,['Can you share the project notes?','See you tomorrow!','The design looks great.','Let’s catch up later.','Are we meeting today?'][i])]: db.add(Message(conversation_id=c.id,sender_id=sender.id,body=body))
 c=Conversation(name='Design Team',is_group=True,created_by=users[0].id);db.add(c);db.flush()
 for u in (users[0],users[1],users[2],users[3]): db.add(Member(conversation_id=c.id,user_id=u.id,is_admin=u.id==users[0].id))
 db.add(Message(conversation_id=c.id,sender_id=users[2].id,body='Welcome to the design team!'))
 db.commit();print('Seeded demo users. Login: alexmorgan / demo1234 (all users share demo1234)')
