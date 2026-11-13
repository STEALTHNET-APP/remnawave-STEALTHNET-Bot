import os
import pty
import select
import subprocess
import time
import unittest
from pathlib import Path

script = Path(__file__).resolve().parents[1] / 'dist/scripts/reset-admin-password.js'

class RecoveryCliTest(unittest.TestCase):
    def dialogue(self, actions):
        master, slave = pty.openpty()
        proc = subprocess.Popen(['node', str(script), '--email', 'test@example.invalid'], stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        output = b''
        try:
            for prompt, answer in actions:
                deadline = time.monotonic() + 10
                while prompt.encode() not in output:
                    if time.monotonic() > deadline: self.fail('Prompt did not appear')
                    if select.select([master], [], [], .2)[0]: output += os.read(master, 8192)
                os.write(master, answer)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if select.select([master], [], [], .2)[0]:
                    try: output += os.read(master, 8192)
                    except OSError: break
                if proc.poll() is not None: break
            proc.wait(timeout=2)
            return proc.returncode, output.decode(errors='replace')
        finally:
            if proc.poll() is None: proc.kill(); proc.wait()
            os.close(master)

    def test_hidden_password_and_mismatch(self):
        code, output = self.dialogue([('Новый пароль', b'private-test-password\n'), ('Повторите пароль', b'different-test-password\n')])
        self.assertNotEqual(code, 0)
        self.assertIn('Пароли не совпадают', output)
        self.assertNotIn('private-test-password', output)
        self.assertNotIn('different-test-password', output)

    def test_cancel(self):
        code, output = self.dialogue([('Новый пароль', b'\x03')])
        self.assertNotEqual(code, 0)
        self.assertIn('Отменено', output)

    def test_noninteractive_refused(self):
        result = subprocess.run(['node', str(script)], input='', capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Запустите команду в терминале', result.stderr)

    def test_password_argument_refused(self):
        result = subprocess.run(['node', str(script), '--password', 'dont-print-this'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('dont-print-this', result.stdout + result.stderr)

if __name__ == '__main__': unittest.main()
