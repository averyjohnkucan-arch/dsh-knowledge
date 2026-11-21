"""Verify source access with the reader's Kerberos ticket. Input is server-generated."""
import hashlib
import json
import os
import sys

from samba import NTSTATUSError, credentials, ntstatus
from samba.dcerpc import security
from samba.samba3 import libsmb_samba_internal as smb
from samba.samba3 import param


def permitted(connection, parts, directory, digest=None):
    path = "\\".join(parts)
    flags = smb.FILE_SHARE_READ | smb.FILE_SHARE_WRITE | smb.FILE_SHARE_DELETE
    handle, info, _ = connection.create_ex(
        path, DesiredAccess=security.SEC_DIR_LIST if directory else security.SEC_FILE_READ_DATA,
        CreateDisposition=smb.FILE_OPEN, ShareAccess=smb.FILE_SHARE_READ if digest else flags,
        CreateOptions=smb.FILE_DIRECTORY_FILE if directory else smb.FILE_NON_DIRECTORY_FILE,
    )
    try:
        if not digest:
            return True
        hasher = hashlib.sha256()
        offset = 0
        size = info["end_of_file"]
        while offset < size:
            data = connection.read(handle, offset, min(65536, size - offset))
            if not data:
                return False
            hasher.update(data)
            offset += len(data)
        return hasher.hexdigest() == digest
    finally:
        connection.close(handle)


def ticket():
    creds = credentials.Credentials()
    creds.set_named_ccache(os.environ["KRB5CCNAME"])
    creds.set_kerberos_state(credentials.MUST_USE_KERBEROS)
    creds.set_smb_signing(credentials.SMB_SIGNING_REQUIRED)
    creds.set_smb_encryption(credentials.SMB_ENCRYPTION_REQUIRED)
    return creds


def check(items):
    settings = param.get_context()
    settings.set("client min protocol", "SMB3")
    creds = ticket()
    connections, folders = {}, {}
    results = []
    denied = {getattr(ntstatus, "NT_STATUS_" + name) for name in (
        "ACCESS_DENIED", "OBJECT_NAME_NOT_FOUND", "OBJECT_PATH_NOT_FOUND", "NOT_A_DIRECTORY",
        "FILE_IS_A_DIRECTORY", "SHARING_VIOLATION", "DELETE_PENDING", "BAD_NETWORK_NAME",
        "OBJECT_NAME_INVALID", "STOPPED_ON_SYMLINK", "NO_SUCH_FILE",
    )}
    for item in items:
        target = (item["server"], item["share"])
        parts = tuple(item["parts"])
        try:
            if target not in connections:
                connections[target] = smb.Conn(*target, lp=settings, creds=creds)
            connection = connections[target]
            allowed = True
            for n in range(len(parts) + (1 if item["directory"] else 0)):
                key = (target, parts[:n])
                if key not in folders:
                    try:
                        folders[key] = permitted(connection, parts[:n], True)
                    except NTSTATUSError as error:
                        if error.args[0] not in denied:
                            raise
                        folders[key] = False
                if not folders[key]:
                    allowed = False
                    break
            if allowed and not item["directory"]:
                allowed = permitted(connection, parts, False, item.get("digest"))
            results.append(allowed)
        except NTSTATUSError as error:
            if error.args[0] not in denied:
                raise
            results.append(False)
    return results


def roles(dc, configured):
    import ldb
    from samba import gensec
    from samba.ndr import ndr_unpack
    from samba.param import LoadParm
    from samba.samdb import SamDB

    settings = LoadParm()
    settings.set("client ldap sasl wrapping", "seal")
    creds = ticket()
    creds.set_gensec_features(creds.get_gensec_features() | gensec.FEATURE_SEAL)
    db = SamDB(url="ldap://" + dc, credentials=creds, lp=settings)
    root = db.search(base="", scope=ldb.SCOPE_BASE, attrs=["tokenGroups"])[0]
    token = [str(ndr_unpack(security.dom_sid, val)) for val in root["tokenGroups"]]
    user = db.search(base="<SID=" + token[0] + ">", scope=ldb.SCOPE_BASE,
                     attrs=["tokenGroups", "userAccountControl", "objectClass"])[0]
    if b"user" not in list(user["objectClass"]) or int(str(user["userAccountControl"])) & 2:
        return {"reauth": True}
    current = {str(ndr_unpack(security.dom_sid, val)) for val in user["tokenGroups"]}
    # A stale Kerberos PAC may contain an old allow group or omit a new deny group.
    # Renew the complete SMB logon on either change, including groups outside KB roles.
    def domain_groups(values):
        return {sid for sid in values if sid.startswith("S-1-5-21-") and not sid.startswith("S-1-5-21-0-0-0-") and sid != token[0]}
    if domain_groups(current) != domain_groups(token[1:]):
        return {"reauth": True}
    effective = set(token).intersection(current)
    names = {g for groups in configured.values() for g in groups}
    clauses = []
    for name in names:
        attr = "objectSid" if name.upper().startswith("S-1-") else "sAMAccountName"
        clauses.append("(" + attr + "=" + ldb.binary_encode(name) + ")")
    rows = db.search(base=db.domain_dn(), scope=ldb.SCOPE_SUBTREE,
                     expression="(&(objectClass=group)(|" + "".join(clauses) + "))",
                     attrs=["objectSid", "groupType", "sAMAccountName"])
    found = set()
    for row in rows:
        sid = str(ndr_unpack(security.dom_sid, bytes(row["objectSid"][0])))
        if int(str(row["groupType"])) & 0x80000000 and sid in effective:
            found.update([sid.casefold(), str(row["sAMAccountName"]).casefold()])
    return [action for action, groups in configured.items() if any(g.casefold() in found for g in groups)]


if __name__ == "__main__":
    request = json.load(sys.stdin)
    print(json.dumps(check(request) if isinstance(request, list) else roles(request["dc"], request["groups"])))
