# State certificates Souspli vouches for

A passport is verified against the signing certificate (CSCA) of the state that issued it, and a
letter must verify with no network, so these ship inside the app (`../trust.ts` inlines them).
The header names the certificate a passport chained to. **Adding one is a decision about whom
every Souspli user trusts to issue passports**: record where it came from and how it was checked,
as below.

The zero-knowledge proof verifier pins the same set a second way, as a certificate-registry root
in `../pins.json`. That root is computed by the NFC ID tools (`zk/package.sh --pins`) from these
same files with a fixed timestamp; change the files and it must be recomputed.

`../pins.json` also holds what single-proof packages are checked against: the root of zkPassport's
**circuit registry** for the circuits release named there, and the verification keys of its outer
circuits. The NFC ID tools print these (`zk/outer-pins.sh`), and refuse to unless each key hashes
to the value in zkPassport's own published list for that release. Moving to a newer circuits
release means replacing all of them together; proofs made with the old release then stop
verifying, so keep the old root and keys alongside for as long as old letters should.

## Canada

Country Signing CA certificates for Canadian ePassports (`CN=csca-canada, OU=pptc, O=gc, C=CA`). These are public trust anchors for verifying Document Signer certificates (DSCs).

All five keys are **RSA-4096**, and every certificate is signed with **RSA-PSS** (SHA-256).

| File | Kind | Key (SKI) | Signed by (AKI) | Certificate validity | Key used to sign until |
|---|---|---|---|---|---|
| `csca-canada-2012.pem` | Self-signed CSCA | `8C:8E:97:69…` | itself | 2012-12-05 → 2028-06-05 | 2017-11-21 |
| `csca-canada-2017.pem` | Self-signed CSCA | `CA:A7:05:CF…` | itself | 2017-09-12 → 2033-03-12 | 2022-08-28 |
| `csca-canada-2022.pem` | Self-signed CSCA | `96:57:CF:85…` | itself | 2022-08-30 → 2038-02-28 | 2027-08-16 |
| `link-2012-to-2017.pem` | Link certificate | `CA:A7:05:CF…` (2017 key) | 2012 key | 2017-09-12 → 2033-03-12 | 2022-08-28 |
| `link-2017-to-2022.pem` | Link certificate | `96:57:CF:85…` (2022 key) | 2017 key | 2022-08-30 → 2038-02-28 | 2027-08-16 |

The "used to sign until" date is the end of the Private Key Usage Period: the last day that key could sign DSCs or CRLs. The certificate stays valid for verification long after that.

### SHA-256 fingerprints

```
csca-canada-2012   7C2AAD9DAE87EED6935E84BC450AAB4FAC57CFFB5324DBD06DC494569B294863
csca-canada-2017   FCDF2A36374E1CC25E75C5BFC216A53A611DEE813B687DB0962D75B330A12031
csca-canada-2022   F462638ADEDE314AE0F4CD7689441DD393601A3F51BF271BBDC2BF1815977D71
link-2012-to-2017  2B4A778C08909A2F13CB736F19FA577D3803735B3312EEF883BE9DB670E799ED
link-2017-to-2022  EEF7E623B97E4024C738DAE14F1F3489696BF2B6A9B6EE49E9F8B76171BE6056
```

`sha256sum -c SHA256SUMS` in `canada/` checks the files themselves. Those hashes are of the PEM files, not the certificate fingerprints above.

### Provenance

Extracted on 2026-11-17 from the **German CSCA Master List** issued 2026-10-01 (`DE_ML_2026-10-01-11-50-52.ml`), downloaded from [BSI](https://bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/GermanMasterList.html). That ZIP's SHA-256 is `a0d2b448d8a2ef383c66991897c970ab2f0494173d33ef0d55195127dae08a6a`.

Checks done:
1. **Master list:** its CMS signature verifies against `CN=CSCA Master List Signer`. That signer's ECDSA-SHA512 signature verifies against the German CSCA (`2084AED7…ADA8`, 10/24) and its link certificate (`5F28CB69…20BD`). Both fingerprints match the values BSI publishes on its [root certificate page](https://bsi.bund.de/EN/Themen/Oeffentliche-Verwaltung/Elektronische-Identitaeten/Public-Key-Infrastrukturen/CSCA/Root_Cert_Germany/Root_Certificate_node.html).
2. **Canadian certificates:**
   - Every CSCA's self-signature verifies.
   - Each link certificate verifies against the previous CSCA and carries the same public key as the next one.
3. **A real DSC:** a Canadian passport's DSC (`CN=DS06`, serial `4942D23A`, RSA-PSS 2048) verifies against `csca-canada-2017` and fails against the 2012 and 2022 keys. It is not listed in the ICAO PKD CRL for Canada ([`CAN.crl`](https://pkddownload1.icao.int/CRLs/CAN.crl), 2026-10-22, signed by the 2022 key).

Trust in these certificates rests on BSI having collected and checked them. For stronger assurance, compare the fingerprints against a second source such as the ICAO PKD master list.
