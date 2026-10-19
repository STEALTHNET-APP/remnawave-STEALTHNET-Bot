import io
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from PIL import Image

initial = tempfile.TemporaryDirectory()
os.environ['DATA_DIR'] = initial.name
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app

class ReportsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = create_app({'TESTING':True, 'DATA_DIR':self.temp.name, 'PUBLIC_URL':'https://reports.test', 'PANEL_URL':'http://panel.test'})
        self.client = self.app.test_client()
        self.headers = {'Origin':'https://reports.test'}

    def submit(self, **changes):
        data = dict(title='Не сохраняется тариф', area='Панель', version='6.7.1', steps='Открыть тариф, изменить название и сохранить.', actual='Название осталось прежним', expected='Новое название', contact='private@example.invalid')
        with patch("app.secrets.choice", return_value="2"):
            challenge = self.client.get("/api/captcha").json
        data.update(captcha_token=challenge["token"], captcha_answer="222222")
        data.update(changes)
        return self.client.post('/api/reports', data=data, headers=self.headers)

    def admin(self, role='ADMIN', twofa=False):
        calls=[]
        class Response:
            def __init__(self, payload): self.payload=payload
            def __enter__(self): return io.BytesIO(__import__('json').dumps(self.payload).encode())
            def __exit__(self,*args): pass
        def remote(req, **kwargs):
            calls.append(req.full_url)
            if req.full_url.endswith('/logout'): return Response({'success':True})
            if twofa and req.full_url.endswith('/login'): return Response({'requires2FA':True,'tempToken':'temporary-test-token'})
            return Response({'admin':{'email':'admin@example.invalid','role':role,'mustChangePassword':False},'accessToken':'unused','refreshToken':'revoked'})
        with patch('urllib.request.urlopen',side_effect=remote):
            result=self.client.post('/api/admin/login',json={'email':'admin@example.invalid','password':'test-password'},headers=self.headers)
            if twofa:
                self.assertTrue(result.json['requires2FA'])
                self.assertEqual(self.client.get('/api/admin/reports').status_code,401)
                result=self.client.post('/api/admin/login',json={'code':'123456'},headers=self.headers)
        return result

    def test_moderation_and_private_fields(self):
        response=self.submit()
        self.assertEqual(response.status_code,201)
        rid=response.json['id']
        self.assertEqual(self.client.get('/api/reports').json['total'],0)
        self.assertEqual(self.client.get('/api/reports/'+str(rid)).status_code,404)
        self.assertEqual(self.client.get('/api/admin/reports').status_code,401)
        self.assertEqual(self.admin().status_code,200)
        private=self.client.get('/api/admin/reports').json['items'][0]
        self.assertEqual(private['contact'],'private@example.invalid')
        response=self.client.patch('/api/admin/reports/'+str(rid),json={'status':'done','published':True,'answer':'исправлено'},headers=self.headers)
        self.assertEqual(response.status_code,200)
        public=self.client.get('/api/reports/'+str(rid)).json
        self.assertEqual(public['status'],'done')
        self.assertNotIn('contact',public)
        self.assertNotIn('attachments',public)
        self.assertEqual(self.client.get('/api/reports?status=done&q=тариф').json['total'],1)
        self.client.post('/api/admin/logout',headers=self.headers)
        self.assertEqual(self.client.get('/api/admin/reports').status_code,401)

    def test_csrf_roles_and_two_factor(self):
        self.assertEqual(self.client.post('/api/reports',data={}).status_code,403)
        self.assertEqual(self.admin('MANAGER').status_code,403)
        self.assertEqual(self.admin(twofa=True).status_code,200)
        self.assertEqual(self.client.get('/api/admin/reports').status_code,200)

    def test_attachment_reencoding_and_access(self):
        picture=io.BytesIO();Image.new('RGB',(20,20),'white').save(picture,'PNG');picture.seek(0)
        self.assertEqual(self.submit(files=(picture,'../../example.png')).status_code,201)
        self.admin()
        report=self.client.get('/api/admin/reports').json['items'][0]
        name=report['attachments'][0]
        response=self.client.get('/api/admin/attachments/'+name)
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.data.startswith(b'\xff\xd8'))
        response.close()
        self.client.post('/api/admin/logout',headers=self.headers)
        self.assertEqual(self.client.get('/api/admin/attachments/'+name).status_code,401)

    def test_validation_rate_limit_and_headers(self):
        self.assertEqual(self.submit(title='x').status_code,400)
        self.assertEqual(self.submit(files=(io.BytesIO(b'<script>alert(1)</script>'),'x.png')).status_code,400)
        for _ in range(5): self.assertEqual(self.submit().status_code,201)
        self.assertEqual(self.submit().status_code,429)
        response=self.client.get('/')
        self.assertIn("frame-ancestors 'none'",response.headers['Content-Security-Policy'])
        self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
        response.close()

    def test_captcha_required_wrong_and_replay(self):
        self.assertEqual(self.client.post('/api/reports',data={},headers=self.headers).status_code,400)
        with patch('app.secrets.choice',return_value='2'):
            challenge=self.client.get('/api/captcha').json
        self.assertTrue(challenge['image'].startswith('data:image/png;base64,'))
        self.assertNotIn('answer',challenge)
        data=dict(title='CAPTCHA regression',area='Панель',steps='Verify a single-use challenge',captcha_token=challenge['token'],captcha_answer='333333')
        self.assertEqual(self.client.post('/api/reports',data=data,headers=self.headers).status_code,400)
        data['captcha_answer']='222222'
        self.assertEqual(self.client.post('/api/reports',data=data,headers=self.headers).status_code,400)
        with patch('app.secrets.choice',return_value='2'):
            data['captcha_token']=self.client.get('/api/captcha').json['token']
        self.assertEqual(self.client.post('/api/reports',data=data,headers=self.headers).status_code,201)
        self.assertEqual(self.client.post('/api/reports',data=data,headers=self.headers).status_code,400)

    def test_captcha_expiration_and_browser_binding(self):
        with patch('app.secrets.choice',return_value='2'):
            challenge=self.client.get('/api/captcha').json
        data=dict(title='CAPTCHA expiry',area='Панель',steps='Verify expired challenge',captcha_token=challenge['token'],captcha_answer='222222')
        stranger=self.app.test_client()
        self.assertEqual(stranger.post('/api/reports',data=data,headers=self.headers).status_code,400)
        import time
        with patch('app.time.time',return_value=time.time()+301):
            self.assertEqual(self.client.post('/api/reports',data=data,headers=self.headers).status_code,400)

    def test_my_reports_private_until_published(self):
        rid=self.submit().json['id']
        self.assertEqual(self.client.get('/api/my-reports').json['total'],1)
        self.assertEqual(self.client.get('/api/my-reports/'+str(rid)).status_code,200)
        stranger=self.app.test_client()
        self.assertEqual(stranger.get('/api/my-reports').json['total'],0)
        self.assertEqual(stranger.get('/api/my-reports/'+str(rid)).status_code,404)
        self.assertEqual(self.client.get('/api/reports').json['total'],0)
        self.admin()
        self.assertEqual(self.client.get('/api/admin/reports?publication=pending').json['total'],1)
        self.client.patch('/api/admin/reports/'+str(rid),json={'status':'triage','published':True,'answer':'checking'},headers=self.headers)
        self.assertEqual(self.client.get('/api/admin/reports?publication=pending').json['total'],0)
        self.assertEqual(self.client.get('/api/reports').json['total'],1)

    def test_large_valid_screenshot(self):
        picture=io.BytesIO()
        Image.frombytes('RGB',(700,700),os.urandom(700*700*3)).save(picture,'PNG')
        self.assertGreater(picture.tell(),1024*1024)
        picture.seek(0)
        self.assertEqual(self.submit(files=(picture,'screenshot.png')).status_code,201)

if __name__=='__main__': unittest.main()
