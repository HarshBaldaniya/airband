//! The engine's signature. npm's fingerprint only says the download is the file npm meant; anyone
//! who can publish to npm can publish a new file and its fingerprint with it. So each version of
//! the engine is also signed, by the release workflow (scripts/sign-engine.mjs), with the same key
//! as the app's own updates, and the signature is put on the GitHub release of that version. The
//! app installs an engine only when that signature checks out against the public key it was built
//! with (tauri.conf.json's plugins.updater.pubkey, embedded by build.rs).
use super::download::fetch_text;
use crate::error::Result;
use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};

/// The updater's public key: base64 of a minisign public key file.
const PUBLIC_KEY: &str = env!("AIRBAND_UPDATER_PUBKEY");
/// Where the GitHub releases' files are: `<RELEASES>/v<version>/<file>`.
const RELEASES: &str = env!("AIRBAND_RELEASES");

/// Where the signature of engine `version` is.
pub fn url(version: &str) -> String {
    format!("{RELEASES}/v{version}/airband-engine-{version}.tgz.sig")
}

/// Fetches the signature of engine `version` and checks `tarball` against it.
pub fn check(tarball: &[u8], version: &str) -> Result<()> {
    let signature = fetch_text(&url(version))?;
    verify(tarball, signature.trim(), version, PUBLIC_KEY)
}

fn decode(b64: &str) -> Result<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| "a signature that isn't base64")?;
    String::from_utf8(bytes).map_err(|_| "a signature that isn't text".into())
}

/// Checks `data` against `signature` (base64 of a minisign signature file, as `tauri signer sign`
/// writes it) and `public_key` (base64 of a minisign public key file). The signature must also
/// name `version` in its trusted comment, which it covers: a signature of one version can't be
/// passed off as another's.
pub fn verify(data: &[u8], signature: &str, version: &str, public_key: &str) -> Result<()> {
    let key = PublicKey::decode(&decode(public_key)?).map_err(|_| "the app's public key didn't read")?;
    let sig = Signature::decode(&decode(signature)?).map_err(|_| "the signature didn't read")?;
    key.verify(data, &sig, true).map_err(|_| "the signature doesn't match the download")?;
    let signed_for = sig.trusted_comment().split('\t').find_map(|f| f.strip_prefix("version:"));
    if signed_for != Some(version) {
        return Err(format!("the signature is for version {}, not {version}", signed_for.unwrap_or("(none)")).into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // A throwaway key made with `tauri signer generate`, and a signature made with
    // `tauri signer sign --app-version 9.9.9` of a file airband-9.9.9.tgz holding "hello engine".
    const TEST_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IENEODk2OUE5OTk2MDMzNkYKUldSdk0yQ1pxV21KemUxa3k0TUZKTXNaWC9tcU95bzVlWG9qenR3eVBLT1ZrUFdkSWhFUjROYUsK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSdk0yQ1pxV21KemZJcFpEaUJscTRWRTBVNWRrcFJKeFp0OXdqdzRtT0hHNnk2OENPS3ljNHpQUkE1SkdrWWgzN1pKSHNNV1NyUldGVUEzR1VOb0VaRUlBSm5QcGVpUWdNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1NTA0MDgyCWZpbGU6YWlyYmFuZC05LjkuOS50Z3oJdmVyc2lvbjo5LjkuOQpnNEI3WURGeTJtQzUzVnJxL1FsWXozN3VMaHZQaDRrcURVVExPUlU1UDlPOW1mcGYybnk2b0ljQUZlOGpkdTEvY2dmUDVkSERBNWdldGRJdzVNa0NBdz09Cg==";
    const DATA: &[u8] = b"hello engine";

    #[test]
    fn accepts_the_signed_file() {
        verify(DATA, TEST_SIGNATURE, "9.9.9", TEST_KEY).unwrap();
    }

    #[test]
    fn refuses_a_changed_file() {
        assert!(verify(b"hello engine!", TEST_SIGNATURE, "9.9.9", TEST_KEY).is_err());
    }

    #[test]
    fn refuses_a_signature_of_another_version() {
        let e = verify(DATA, TEST_SIGNATURE, "9.9.10", TEST_KEY).unwrap_err();
        assert!(e.to_string().contains("9.9.9"), "{e}");
    }

    #[test]
    fn refuses_another_key() {
        assert!(verify(DATA, TEST_SIGNATURE, "9.9.9", PUBLIC_KEY).is_err());
        assert!(verify(DATA, "not base64!", "9.9.9", TEST_KEY).is_err());
    }

    #[test]
    fn the_apps_own_key_reads() {
        assert!(PublicKey::decode(&decode(PUBLIC_KEY).unwrap()).is_ok());
    }

    #[test]
    fn the_signature_is_on_the_versions_release() {
        assert!(url("0.1.7").starts_with("https://github.com/"));
        assert!(url("0.1.7").ends_with("/releases/download/v0.1.7/airband-engine-0.1.7.tgz.sig"));
    }
}
