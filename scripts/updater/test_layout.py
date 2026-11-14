import copy
import unittest

from deployment import Deployment


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.updater = Deployment()
        self.before = {
            'name': 'stealthnet',
            'services': {
                'bot': {'image': 'old'},
                'api': {'image': 'old'},
                'postgres': {'image': 'postgres:16', 'volumes': [
                    {'type': 'volume', 'source': 'postgres_data', 'target': '/var/lib/postgresql/data'},
                ]},
            },
            'volumes': {'postgres_data': {'name': 'stealthnet_postgres_data'}},
            'networks': {'default': {'name': 'stealthnet_default'}},
        }
        self.after = copy.deepcopy(self.before)
        self.after['volumes']['bot_preferences'] = {'name': 'stealthnet_bot_preferences'}
        self.after['services']['bot'].update(image='new', volumes=[{
            'type': 'volume', 'source': 'bot_preferences', 'target': '/data/widget-preferences', 'volume': {},
        }])

    def test_691_to_700_adds_preferences_without_mutating_input(self):
        original = copy.deepcopy(self.after)
        self.updater.validate_layout(self.before, self.after)
        self.assertEqual(self.after, original)

    def test_existing_preferences_and_rollback_remain_protected(self):
        self.updater.validate_layout(self.after, copy.deepcopy(self.after))
        with self.assertRaises(RuntimeError):
            self.updater.validate_layout(self.after, self.before)

    def test_rejects_other_storage_or_network_changes_alongside_preferences(self):
        for mutate in (
            lambda value: value['volumes']['postgres_data'].update(name='another_database'),
            lambda value: value['volumes'].pop('postgres_data'),
            lambda value: value['networks']['default'].update(name='another_network'),
            lambda value: value['services']['postgres'].update(image='postgres:17'),
            lambda value: value['services']['api'].update(volumes=[{'type': 'volume', 'source': 'bot_preferences', 'target': '/app'}]),
            lambda value: value['volumes'].update(unreviewed={'name': 'unreviewed'}),
        ):
            with self.subTest(mutate=mutate):
                candidate = copy.deepcopy(self.after)
                mutate(candidate)
                with self.assertRaises(RuntimeError):
                    self.updater.validate_layout(self.before, candidate)

    def test_preferences_must_be_new_local_volume_at_exact_path(self):
        for extra in ({'external': True}, {'driver': 'nfs'}, {'name': 'stealthnet_postgres_data'}, {'driver_opts': {'device': '/'}}):
            with self.subTest(extra=extra):
                candidate = copy.deepcopy(self.after)
                candidate['volumes']['bot_preferences'].update(extra)
                with self.assertRaises(RuntimeError):
                    self.updater.validate_layout(self.before, candidate)
        for extra in ({'target': '/app'}, {'source': 'postgres_data'}, {'type': 'bind'}, {'read_only': True}, {'volume': {'subpath': 'data'}}):
            with self.subTest(extra=extra):
                candidate = copy.deepcopy(self.after)
                candidate['services']['bot']['volumes'][0].update(extra)
                with self.assertRaises(RuntimeError):
                    self.updater.validate_layout(self.before, candidate)

    def test_does_not_hide_existing_bot_data_or_remove_mounts(self):
        for target in ('/', '/data', '/data/widget-preferences', '/data/widget-preferences/nested'):
            with self.subTest(target=target):
                before = copy.deepcopy(self.before)
                existing = {'type': 'bind', 'source': '/operator/data', 'target': target}
                before['services']['bot']['volumes'] = [existing]
                after = copy.deepcopy(self.after)
                after['services']['bot']['volumes'].insert(0, existing)
                with self.assertRaises(RuntimeError):
                    self.updater.validate_layout(before, after)
        before = copy.deepcopy(self.before)
        before['services']['bot']['volumes'] = [{'type': 'bind', 'source': '/operator/data', 'target': '/other'}]
        with self.assertRaises(RuntimeError):
            self.updater.validate_layout(before, self.after)
        after = copy.deepcopy(self.after)
        after['services']['bot']['volumes'] = before['services']['bot']['volumes'] + after['services']['bot']['volumes']
        self.updater.validate_layout(before, after)
