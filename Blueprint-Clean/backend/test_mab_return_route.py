import ast
from pathlib import Path
from urllib.parse import urlparse
import unittest

class ReturnRouteTest(unittest.TestCase):
    def test_only_mab_return_changes(self):
        tree = ast.parse(Path(__file__).with_name('server.py').read_text(encoding='utf-8-sig'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build_checkout_return_urls')
        namespace = {'urlparse': urlparse}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<return-route>', 'exec'), namespace)
        build = namespace['build_checkout_return_urls']
        for origin, expected in [('https://mytonite86-coder.github.io', 'https://mytonite86-coder.github.io/MAB-Path-Editor/path'), ('http://localhost:8082', 'http://localhost:8082/path')]:
            success, cancel = build(origin, 'mab_s1')
            self.assertEqual(success, expected + '?session_id={CHECKOUT_SESSION_ID}&checkout=success')
            self.assertEqual(cancel, expected + '?checkout=cancel')
        self.assertEqual(build('https://mytonite86-coder.github.io', 'pathseal')[0], 'https://mytonite86-coder.github.io/svg-path-closer?session_id={CHECKOUT_SESSION_ID}&checkout=success')

if __name__ == '__main__':
    unittest.main()
