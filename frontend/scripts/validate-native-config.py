"""Structural validation of everything hand-written for the native projects."""
import io
import os
import plistlib
import sys
import xml.etree.ElementTree as ET

out = io.open(sys.stdout.fileno(), 'w', encoding='utf-8', closefd=False)
fails = []


def ok(label, detail=''):
    out.write(f'  ok   {label:<52} {detail}\n')


def bad(label, detail):
    fails.append(label)
    out.write(f'  FAIL {label:<52} {detail}\n')


def check_xml(path, label):
    if not os.path.exists(path):
        bad(label, 'missing')
        return None
    try:
        tree = ET.parse(path)
        ok(label, f'<{tree.getroot().tag}>')
        return tree
    except ET.ParseError as e:
        bad(label, f'parse error: {e}')
        return None


def check_plist(path, label):
    if not os.path.exists(path):
        bad(label, 'missing')
        return None
    try:
        with open(path, 'rb') as fh:
            data = plistlib.load(fh)
        ok(label, f'{len(data)} keys')
        return data
    except Exception as e:
        bad(label, f'invalid plist: {e}')
        return None


# Resolved from this file rather than the working directory, so the script
# behaves the same whether it is run from the repo root or via the
# `mobile:check` npm script inside frontend/.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'android', 'app', 'src')
I = os.path.join(ROOT, 'ios', 'App', 'App')

out.write('ANDROID XML\n')
man = check_xml(f'{A}/main/AndroidManifest.xml', 'AndroidManifest.xml')
check_xml(f'{A}/main/res/xml/network_security_config.xml', 'network_security_config.xml (release)')
check_xml(f'{A}/debug/res/xml/network_security_config.xml', 'network_security_config.xml (debug)')
check_xml(f'{A}/main/res/xml/backup_rules.xml', 'backup_rules.xml')
check_xml(f'{A}/main/res/xml/data_extraction_rules.xml', 'data_extraction_rules.xml')
check_xml(f'{A}/main/res/xml/file_paths.xml', 'file_paths.xml')

out.write('\niOS PLISTS\n')
info = check_plist(f'{I}/Info.plist', 'Info.plist')
priv = check_plist(f'{I}/PrivacyInfo.xcprivacy', 'PrivacyInfo.xcprivacy')

# --- manifest semantics ------------------------------------------------------
out.write('\nANDROID MANIFEST SEMANTICS\n')
if man is not None:
    NS = '{http://schemas.android.com/apk/res/android}'
    app = man.getroot().find('application')

    def attr(el, name):
        return el.get(NS + name) if el is not None else None

    checks = [
        ('allowBackup is false', attr(app, 'allowBackup'), 'false'),
        ('usesCleartextTraffic is false', attr(app, 'usesCleartextTraffic'), 'false'),
        ('networkSecurityConfig set', attr(app, 'networkSecurityConfig'),
         '@xml/network_security_config'),
        ('dataExtractionRules set', attr(app, 'dataExtractionRules'),
         '@xml/data_extraction_rules'),
        ('fullBackupContent set', attr(app, 'fullBackupContent'), '@xml/backup_rules'),
    ]
    for label, got, want in checks:
        (ok if got == want else bad)(label, got if got == want else f'{got!r} want {want!r}')

    # No custom Application class that does not exist on disk.
    app_cls = attr(app, 'name')
    if app_cls:
        rel = app_cls.lstrip('.').replace('.', '/')
        found = any(
            os.path.exists(os.path.join(A, 'main', 'java', 'ca', 'foodloss', 'iwm', f'{rel}.{ext}'))
            for ext in ('java', 'kt')
        )
        (ok if found else bad)('android:name class exists', app_cls)
    else:
        ok('no custom Application class', 'uses the framework default')

    acts = app.findall('activity')
    main = next((a for a in acts if attr(a, 'name') == '.MainActivity'), None)
    if main is None:
        bad('MainActivity present', 'not found')
    else:
        ok('MainActivity present', '')
        (ok if attr(main, 'exported') == 'true' else bad)(
            'MainActivity exported (launcher needs it)', attr(main, 'exported'))
        (ok if attr(main, 'resizeableActivity') == 'true' else bad)(
            'resizeableActivity true (tablets/foldables)', attr(main, 'resizeableActivity'))

    perms = [attr(p, 'name') for p in man.getroot().findall('uses-permission')]
    removed = [
        attr(p, 'name') for p in man.getroot().findall('uses-permission')
        if p.get('{http://schemas.android.com/tools}node') == 'remove'
    ]
    declared = [p for p in perms if p not in removed]
    expected = {
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
    }
    extra = set(declared) - expected
    (ok if not extra else bad)(
        'only INTERNET + ACCESS_NETWORK_STATE declared',
        ', '.join(sorted(s.rsplit('.', 1)[-1] for s in declared)) or 'none',
    )
    (ok if len(removed) == 2 else bad)(
        'legacy storage permissions removed', f'{len(removed)} tools:node=remove')

# --- release network config must not permit cleartext anywhere --------------
out.write('\nRELEASE NETWORK POLICY\n')
rel_cfg = f'{A}/main/res/xml/network_security_config.xml'
if os.path.exists(rel_cfg):
    root = ET.parse(rel_cfg).getroot()
    permits = [
        el.tag for el in root.iter()
        if el.get('cleartextTrafficPermitted') == 'true'
    ]
    (ok if not permits else bad)(
        'no cleartext permitted in release config',
        'clean' if not permits else f'permitted in <{permits[0]}>')
    anchors = [c.get('src') for c in root.iter('certificates')]
    (ok if 'user' not in anchors else bad)(
        'user CAs not trusted in release', ', '.join(a or '?' for a in anchors))

# --- file_paths must not expose external storage ----------------------------
fp = f'{A}/main/res/xml/file_paths.xml'
if os.path.exists(fp):
    root = ET.parse(fp).getroot()
    tags = [c.tag for c in root]
    wide = [t for t in tags if t.startswith('external')]
    (ok if not wide else bad)(
        'FileProvider does not expose external storage',
        ', '.join(tags))

# --- iOS plist semantics -----------------------------------------------------
out.write('\niOS PLIST SEMANTICS\n')
if info is not None:
    ats = info.get('NSAppTransportSecurity', {})
    (ok if ats.get('NSAllowsArbitraryLoads') is False else bad)(
        'ATS: arbitrary loads disabled', ats.get('NSAllowsArbitraryLoads'))
    (ok if ats.get('NSAllowsArbitraryLoadsInWebContent') is False else bad)(
        'ATS: web content not exempt', ats.get('NSAllowsArbitraryLoadsInWebContent'))
    (ok if info.get('ITSAppUsesNonExemptEncryption') is False else bad)(
        'export compliance declared', info.get('ITSAppUsesNonExemptEncryption'))
    (ok if info.get('UIRequiresFullScreen') is False else bad)(
        'iPad multitasking allowed', info.get('UIRequiresFullScreen'))
    caps = info.get('UIRequiredDeviceCapabilities', [])
    (ok if 'armv7' not in caps else bad)(
        'no obsolete armv7 requirement', ', '.join(caps))
    usage = [k for k in info if k.endswith('UsageDescription')]
    (ok if not usage else bad)(
        'no unused permission strings', ', '.join(usage) or 'none')

if priv is not None:
    (ok if priv.get('NSPrivacyTracking') is False else bad)(
        'privacy: tracking false', priv.get('NSPrivacyTracking'))
    for key in ('NSPrivacyTrackingDomains', 'NSPrivacyCollectedDataTypes',
                'NSPrivacyAccessedAPITypes'):
        (ok if key in priv else bad)(f'privacy: {key} present', '')
    apis = priv.get('NSPrivacyAccessedAPITypes', [])
    for entry in apis:
        reasons = entry.get('NSPrivacyAccessedAPITypeReasons', [])
        cat = entry.get('NSPrivacyAccessedAPIType', '?')
        (ok if reasons else bad)(
            f'  {cat.replace("NSPrivacyAccessedAPICategory", "")} has a reason',
            ', '.join(reasons))

# --- pbxproj integrity -------------------------------------------------------
out.write('\nXCODE PROJECT\n')
pbx = os.path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj')
text = io.open(pbx, encoding='utf-8').read()
(ok if text.count('{') == text.count('}') else bad)(
    'braces balanced', f"{text.count('{')} open / {text.count('}')} close")
(ok if text.count('(') == text.count(')') else bad)(
    'parens balanced', f"{text.count('(')} open / {text.count(')')} close")

for label, needle, want in [
    # Info.plist shares the text.plist.xml file type, so the needle names the path.
    ('xcprivacy: PBXFileReference', 'path = PrivacyInfo.xcprivacy;', 1),
    ('xcprivacy: PBXBuildFile', 'PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile', 1),
    ('xcprivacy: in Resources phase', 'PrivacyInfo.xcprivacy in Resources */,', 1),
    ('xcprivacy: in App group', '/* PrivacyInfo.xcprivacy */,', 1),
]:
    got = text.count(needle)
    (ok if got == want else bad)(label, f'{got} occurrence(s), want {want}')

(ok if text.rstrip().endswith('}') else bad)('file terminates cleanly', text.rstrip()[-40:])

out.write('\n' + (f'{len(fails)} FAILURES: ' + ', '.join(fails) if fails else 'all pass') + '\n')
sys.exit(1 if fails else 0)
