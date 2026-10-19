import os
import sys
import json
import hashlib
import uuid
from pathlib import Path

sys.path.insert(0, os.environ['AWP_SOURCE'])
os.environ['DATA_FILE'] = os.environ['AWP_QA_DATA']
import app as panel
from fastapi import Request

panel.app.router.on_startup.clear()
peers = {}
fault = {'after_create': False, 'toggle': 0}
token = 'awp_isolated_contract_test_token_only'
panel.save_data({'servers': [{'uid': 'server-qa', 'host': '127.0.0.1', 'ssh_port': 22, 'name': 'QA', 'protocols': {'awg2': {'port': '51820'}, 'wireguard': {'port': '51821'}, 'xray': {'port': '443'}}}], 'users': [{'id': 'admin-qa', 'username': 'qa', 'role': 'admin', 'enabled': True}], 'user_connections': [], 'api_tokens': [{'id': 'token-qa', 'token_hash': hashlib.sha256(token.encode()).hexdigest(), 'user_id': 'admin-qa'}], 'settings': {}})

class SSH:
    def connect(self): pass
    def disconnect(self): pass
    def run_command(self, cmd): return ('0 100', '', 0)

class Manager:
    def add_client(self, protocol, name, *args, **kwargs):
        key = str(uuid.uuid4())
        peers[key] = {'clientId': key, 'userData': {'clientName': name, 'enabled': True}}
        if fault['after_create']:
            fault['after_create'] = False
            raise RuntimeError('injected response loss after creating peer')
        return {'client_id': key, 'config': self.get_client_config(protocol, key)}
    def get_clients(self, *args): return list(peers.values())
    def get_client_config(self, protocol, key, *args, **kwargs):
        if key not in peers: raise RuntimeError('peer missing')
        if protocol == 'xray': return 'vless://00000000-0000-4000-8000-000000000001@example.invalid:443?security=tls'
        return '[Interface]\nPrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nAddress = 10.8.0.2/32\n\n[Peer]\nPublicKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nEndpoint = 127.0.0.1:51820\nAllowedIPs = 0.0.0.0/0\n'
    def toggle_client(self, protocol, key, enabled):
        if fault['toggle']:
            fault['toggle'] -= 1
            raise RuntimeError('injected native toggle failure')
        peers[key]['userData']['enabled'] = enabled
    def remove_client(self, protocol, key): peers.pop(key, None)

panel.get_ssh = lambda server: SSH()
panel.get_protocol_manager = lambda ssh, protocol: Manager()

@panel.app.post('/qa/control')
async def control(request: Request):
    args = await request.json()
    if args.get('after_create'): fault['after_create'] = True
    if 'toggle_failures' in args: fault['toggle'] = args['toggle_failures']
    data = panel.load_data()
    if 'admin_enabled' in args: data['users'][0]['enabled'] = args['admin_enabled']
    if 'admin_role' in args: data['users'][0]['role'] = args['admin_role']
    if args.get('reorder'):
        data['servers'].insert(0, {'uid': 'other-server', 'host': '127.0.0.2', 'protocols': {'awg2': {}}})
        for c in data['user_connections']: c['server_id'] += 1
    if 'traffic' in args:
        for u in data['users']:
            if u['id'] != 'admin-qa': u['traffic_used'] = args['traffic']
    panel.save_data(data)
    return {'data': data, 'peers': peers}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(panel.app, host='127.0.0.1', port=5056, log_level='warning')
