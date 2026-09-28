"""Regression tests for platform-independent Ed25519 challenge signing."""
from __future__ import annotations

import base64
import builtins
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("WEBHARNESS_URL", "https://webharness.chat")
# Never let an imported helper resolve the machine user's real agent identity.
os.environ["WEBHARNESS_HOME"] = str(Path(tempfile.gettempdir()) / "webharness-inbox-signing-tests")

import inbox

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
except ModuleNotFoundError:
    serialization = None
    Ed25519PrivateKey = None


class InboxSigningTests(unittest.TestCase):
    @unittest.skipIf(Ed25519PrivateKey is None, "Python cryptography is not installed")
    def test_python_signer_signs_exact_utf8_nonce(self) -> None:
        private_key = Ed25519PrivateKey.generate()
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        with tempfile.TemporaryDirectory() as directory:
            key_path = Path(directory) / "temporary-test-key.pem"
            key_path.write_bytes(pem)
            nonce = "challenge/é"

            with patch("inbox.subprocess.check_output", side_effect=AssertionError("must not require OpenSSL")):
                signature = base64.b64decode(inbox.sign(nonce, key_path), validate=True)
            private_key.public_key().verify(signature, nonce.encode("utf-8"))

    def test_openssl_fallback_writes_exact_bytes_without_newline(self) -> None:
        real_import = builtins.__import__

        def without_cryptography(name: str, *args: object, **kwargs: object) -> object:
            if name == "cryptography" or name.startswith("cryptography."):
                raise ModuleNotFoundError("not installed", name="cryptography")
            return real_import(name, *args, **kwargs)

        observed: dict[str, bytes] = {}

        def fake_openssl(command: list[str]) -> bytes:
            observed["message"] = Path(command[-1]).read_bytes()
            self.assertIn("-rawin", command)
            return b"test-signature"

        with patch("builtins.__import__", side_effect=without_cryptography):
            with patch("inbox.subprocess.check_output", side_effect=fake_openssl):
                signature = inbox.sign("challenge/é", Path("unused-key.pem"))

        self.assertEqual(observed["message"], "challenge/é".encode("utf-8"))
        self.assertEqual(base64.b64decode(signature), b"test-signature")


if __name__ == "__main__":
    unittest.main()
