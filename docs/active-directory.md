# On-premises Active Directory and Windows shares

Employees open **Knowledge** in a personal DeepSeek Harness, enter their domain username and password, and search the shares they can read. The same reader works in a browser over HTTPS. An administrator sees **Administration** after sign-in when their AD security groups grant a management permission. Folder access and KB administration are separate grants.

## Deployment

Use a Linux indexer with Node 24.9 or newer and the Knowledge plugin, an on-premises AD domain controller with a Global Catalog, and Windows shares supporting Kerberos and encrypted SMB 3. The indexer needs working domain DNS, synchronized time and a Kerberos realm configuration. Use DNS names with the correct CIFS and LDAP service principal names. On Debian or Ubuntu, install the client support with the following command.

~~~sh
sudo apt install krb5-user python3-samba cifs-utils
~~~

1. Run the indexer Harness as a dedicated OS account on loopback. Mount each source share using a read-only indexing account. Give the indexer its own private index and model storage.
2. In the private Harness, add an **external folder** KB for each mount. Select the exact mounted share or subfolder, index the files and record the base ID from the local bases API. The existing PDF setup and saved Markdown work with these bases. An existing external base can be used directly.
3. Create an HTTPS certificate for the reader. Allow HTTPS to the reader from employee devices. Keep the Harness web port and index files private. Configure the client machines to trust the issuing CA.
4. Create the deployment and group-policy files below. Replace every example name, path and ID. The deployment file and private key are controlled by the operator. Give the service account permission to atomically replace the group-policy file in its own directory. The deployment file and private key can live in a separate, read-only directory.
5. Set **DSH_KNOWLEDGE_AD_CONFIG** to the absolute deployment file path in the indexer's service environment and restart Harness. The Knowledge button on the indexer opens the authenticated reader. All ordinary Knowledge management and chat routes on that host close when AD mode is enabled.
6. On each employee's computer, install the plugin and set **DSH_KNOWLEDGE_READER_URL** to the reader's HTTPS origin in their personal, loopback-bound Harness environment. Restart Harness, open **Knowledge**, and sign in. For an internal CA, set **NODE_EXTRA_CA_CERTS** to its PEM certificate before starting the personal Harness. Employees can also visit the reader origin directly from a browser.

~~~json
{
  "realm": "CORP.EXAMPLE",
  "domainController": "dc01.corp.example",
  "publicOrigin": "https://knowledge.corp.example:8443",
  "listenHost": "0.0.0.0",
  "port": 8443,
  "certificate": "/etc/knowledge/tls/fullchain.pem",
  "privateKey": "/etc/knowledge/tls/private.pem",
  "groupPolicyFile": "/var/lib/knowledge-policy/groups.json",
  "policyAdmins": ["KB-Access-Administrators"],
  "sessionMinutes": 10,
  "mappings": [
    {
      "baseId": "replace-with-external-base-id",
      "localRoot": "/srv/knowledge/engineering",
      "server": "files01.corp.example",
      "share": "Departments",
      "subfolder": ["Engineering"]
    }
  ]
}
~~~

The local root must be the canonical external base path. It must refer to the same source as the named share and subfolder. A mapping exposes only source-bound files and directories. Uploaded files, pasted text, URLs, internal bases and legacy rows without a verified source hash stay private. Sync or reparse older external sources to generate current provenance. Configure direct share targets. DFS referral and cross-forest deployments require separate validation.

## AD group assignments

The separate group-policy file contains these four permissions. At least one reader group is required. An empty list disables that permission. Use an AD security group's sAMAccountName or SID. Membership in any listed group grants that one capability. Use the SID when a group may be renamed. To find a group's SID with the AD PowerShell module, run **(Get-ADGroup 'KB-Operators').SID.Value**.

~~~json
{
  "read": ["KB-Readers"],
  "settings": ["KB-Settings-Admins"],
  "sync": ["KB-Operators"],
  "models": ["KB-Model-Admins"]
}
~~~

| Permission | What its members can do |
| --- | --- |
| read | Browse visible folders, search, read cited passages, and download accessible Markdown and originals. |
| settings | Change global defaults or a visible base's search mode, result count, minimum relevance, surrounding chunks, chunk size and overlap, OCR, and internal Markdown retention. |
| sync | Request a sync of an existing mapped base whose root they can list. |
| models | Start the packaged PDF OCR, embedding and reranker setup for a visible mapped base. |
| policyAdmins in the deployment file | Edit the four group assignments in the Knowledge panel. Only the deployment operator can change the policy administrators, source mappings, TLS or provider endpoints. |

To grant an administrator settings access, put their security group in **settings** and add them to that group in AD. Include them in **read** if they also need document access. Nested security groups are supported. **Domain Admins** receives a Knowledge capability only if a configured group grants it. A policy administrator opens **Knowledge → Administration → AD group permissions**, enters one group per line and chooses **Save group permissions**. Concurrent edits to an outdated policy are rejected. Group policy edits apply to subsequent requests. Closing or reopening the panel refreshes visible controls.

The same controls appear in personal Harness under **Settings → Knowledge administration**. For settings changes, choose **Global defaults** or a base, edit the values and choose **Save settings**. Existing base overrides take precedence over global defaults. Reprocess existing sources when changing OCR, chunking or Markdown retention. Sync and model installation have their own buttons and group checks.

## What happens during a search

The indexer keeps a shared index. Initial lexical or vector retrieval selects candidate documents on the trusted server. The file server then opens the parent directories with list permission and the file with read-data permission using the signed-in user's Kerberos ticket. The reader hashes the bytes it can read and compares them with the bytes used to index that document. A replaced, deleted, inaccessible or unsynchronized source is excluded. The search requests further candidates when restricted hits would fill the result window. Only the approved document IDs enter the final retrieval and reranking step. Citations, Markdown downloads and original downloads go through the same signed-in reader. Only the current source revision is accessible.

The indexer checks group membership against the configured domain controller over Kerberos-sealed LDAP. The file server evaluates share and file ACLs, including denies and per-file exceptions. A Windows access failure or unavailable directory cannot grant access. Read decisions are request-scoped. The reader rechecks returned search hits after ranking. Scanning the approved source bytes costs network I/O, particularly for large PDFs. Domain replication affects how quickly an AD change is visible. A changed domain group token requires a fresh sign-in. Sessions default to ten minutes and can be configured between one and fifteen minutes. Direct ACL changes take effect on the next SMB open.

The password travels over HTTPS to the indexer and through stdin to kinit. The indexer holds the Kerberos ticket in a private directory on Linux shared memory until sign-out, expiry or normal shutdown. The personal Harness holds its opaque session credential in process memory. Use one personal Harness instance and OS account per employee. The shared endpoint is the HTTPS Knowledge reader. Existing chat history and previously downloaded copies remain with the user who received them. A directory outage can return an unavailable response. Check DNS, time, the CA chain, Kerberos configuration, the Global Catalog, source mappings and SMB encryption on the indexer when diagnosing a deployment.

Microsoft documents both the authenticated LDAP security context and the distinct Windows rights for listing directories and reading file contents. [LDAP security context](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/5ee0b019-05bc-43b8-8674-b242a987ec1f) · [AD transitive group membership](https://learn.microsoft.com/en-us/windows/win32/adschema/a-tokengroups) · [Windows file and directory access rights](https://learn.microsoft.com/en-us/windows/win32/wmisdk/file-and-directory-access-rights-constants)
