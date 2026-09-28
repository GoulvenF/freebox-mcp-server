<p align="center">
  <img src="logo.svg" alt="Freebox MCP Logo" width="100"/>
</p>

# Freebox MCP Server

**Serveur MCP pour l'API Freebox OS - Contrôlez votre Freebox Server directement depuis les assistants IA compatibles MCP (Claude, Cursor, etc.). Créé par loopion.**

<p align="center">
  <a href="https://github.com/loopion/freebox-mcp-server/releases/latest/download/freebox-mcp-server-latest.mcpb">
    <img src="https://img.shields.io/badge/Add%20to-Claude%20Desktop-D97757?style=for-the-badge" alt="Add to Claude Desktop" />
  </a>
</p>

Ce serveur expose de manière native et unifiée les API de votre Freebox (Revolution, Mini 4K, Pop, Delta, Ultra) via le **Model Context Protocol (MCP)**, ouvrant la voie à une domotique pilotée par l'Intelligence Artificielle.

## Fonctionnalités Principales (Outils)

Le serveur MCP vient équipé avec des dizaines d'outils ("tools") prêts à être utilisés par l'IA :

- **🔐 Authentification :**
  - `freebox_discover` / `freebox_register_app` / `freebox_login` / `freebox_logout`
- **🖥️ Système :**
  - `freebox_system_info` (Version, Températures, Uptime, etc.)
  - `freebox_reboot`
- **🌐 Réseau & Connexion Internet :**
  - `freebox_connection_status` / `freebox_connection_config`
  - Gestion du WiFi (`freebox_wifi_status`, `freebox_wifi_toggle`, `freebox_wifi_stations`)
  - Configuration LAN (`freebox_lan_config`, `freebox_lan_hosts`, `freebox_wol`)
  - Paramétrage DHCP (`freebox_dhcp_config`, gestion des réservations `freebox_dhcp_static_leases`)
  - Redirections de port (`freebox_port_forwarding_list`, etc.)
- **📁 Fichiers & Téléchargements :**
  - Gestion documentaire HTTP/FTP (`freebox_downloads_list`, `freebox_download_add`)
  - Pilote du Disque Dur (`freebox_fs_list`, `freebox_fs_info`, `freebox_fs_mkdir`, moves, renames)
- **🛡️ Réseau avancé** *(depuis v1.1.0)* :
  - Contrôle parental — profils et règles (`freebox_parental_*`)
  - Freeplug / CPL — état du réseau courant porteur en ligne (`freebox_freeplug_*`)
  - VPN serveur Freebox — configuration, utilisateurs, connexions actives (`freebox_vpn_server_*`)
  - Clients VPN — OpenVPN / WireGuard / PPTP (`freebox_vpn_client_*`)
  - UPnP IGD & UPnP AV — redirections et partage média (`freebox_upnp_*`)
  - Partage réseau Samba / AFP (`freebox_netshare_*`)
  - Serveurs FTP et TFTP (`freebox_ftp_*`, `freebox_tftp_*`)
  - Module SFP fibre — statut et configuration (`freebox_sfp_*`)
- **📞 Téléphonie** *(depuis v1.2.0)* :
  - Journal d'appels — liste, lecture, marquage lu, suppression (`freebox_call_log_*`)
  - Messagerie vocale — liste, lecture, marquage lu, suppression (`freebox_voicemail_*`)
  - Carnet de contacts — CRUD contacts, numéros, emails, adresses, urls (`freebox_contact_*`, `freebox_contacts_list`)

---

## 🚀 Installation & Utilisation

### Option A — Installation en un clic sur Claude Desktop (recommandé)

Ce serveur est packagé en **Desktop Extension** (fichier `.mcpb`, le format officiel Anthropic). Aucune configuration JSON à écrire, aucun `npx` en ligne de commande.

1. Cliquez sur le bouton ci-dessus, ou téléchargez directement la **[dernière version du fichier `.mcpb`](https://github.com/loopion/freebox-mcp-server/releases/latest/download/freebox-mcp-server-latest.mcpb)** (ce lien pointe toujours vers la dernière release, quelle que soit sa version).
2. **Double-cliquez** sur le fichier téléchargé (ou glissez-le dans la fenêtre Claude Desktop, ou via *Réglages → Extensions → Paramètres avancés → Installer une extension…*).
3. Claude Desktop affiche l'écran d'installation de l'extension : vérifiez les permissions, réglez éventuellement `FREEBOX_HOST` si votre Freebox n'est pas sur `mafreebox.freebox.fr`, puis validez.
4. Demandez à Claude d'exécuter l'outil `freebox_register_app` et validez l'accès **physiquement via la flèche droite de l'écran LCD de votre Freebox**.

Cette méthode ne fonctionne que sur **Claude Desktop** (macOS/Windows) — pas sur Claude Code ni sur le web.

### Option B — via npm (Node.js requis, tous clients MCP)

Assurez-vous d'avoir **Node.js 18+** installé sur votre machine.

```bash
# Lance et télécharge le serveur automatiquement à l'aide de npx
npx -y freebox-mcp-server
```

#### Configuration manuelle sur Claude Desktop

Ouvrez le fichier de configuration de Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` sur Mac ou `%APPDATA%\Claude\claude_desktop_config.json` sur Windows) et ajoutez le serveur :

```json
{
  "mcpServers": {
    "freebox": {
      "command": "npx",
      "args": ["-y", "freebox-mcp-server"]
    }
  }
}
```

*Note : Lors du premier lancement, vous devrez lui demander d'exécuter l'outil `freebox_register_app` et de valider l'accès **physiquement via la flèche droite de l'écran LCD de votre Freebox**.*

#### Configuration sur Claude Code (CLI)

Depuis votre terminal, ajoutez directement le serveur :

```bash
claude mcp add freebox npx -y freebox-mcp-server
```

---

## ⚠️ Avertissement de sécurité : le fichier `credentials.json`

**À lire avant d'utiliser ce serveur.**

Après `freebox_register_app`, ce serveur écrit un fichier :

```
~/.freebox-mcp/credentials.json
```

Ce fichier contient un **`app_token`** :

- il est **de longue durée et n'expire jamais** — il reste valable tant que vous ne le révoquez pas explicitement ;
- il est stocké **en clair** (le fichier est en `0o600`, mais son contenu n'est pas chiffré) ;
- il équivaut, en pratique, à un **mot de passe maître** sur votre Freebox : quiconque le possède peut ouvrir une session et utiliser toutes les permissions accordées à l'application (réglages, explorateur de fichiers, téléchargements…) — **à condition d'avoir accès au réseau de la Freebox**.

**Portée du risque — réseau local uniquement par défaut.** L'API Freebox n'est pas exposée sur Internet par défaut : `remote_access` / `api_remote_access` sont désactivés, et leur activation exige désormais une confirmation explicite côté serveur (voir plus bas). Le token seul, vu depuis l'extérieur, ne donne donc accès à rien. En revanche, il suffit à quiconque possède **un accès réseau vers la Freebox** — présence physique sur le LAN, WiFi compromis, ou une connexion via le **VPN serveur de la Freebox** elle-même (`freebox_vpn_server_*`) qui place l'attaquant sur le réseau local — pour ouvrir une session complète sans autre vérification.

### Excluez-le de la portée des outils de lecture de fichiers de votre agent

Si votre assistant IA dispose d'outils de lecture de fichiers locaux (Claude Code, Cursor, un agent avec un MCP « filesystem », etc.), **il peut lire ce fichier** et le faire apparaître dans son contexte — donc potentiellement dans des logs, un historique de conversation, ou une réponse renvoyée à un tiers.

Mesures recommandées :

- ajoutez `~/.freebox-mcp/` (et `**/credentials.json`) aux chemins **refusés** de vos outils de lecture de fichiers (par ex. `permissions.deny` dans `~/.claude/settings.json`, ou l'équivalent chez votre client MCP) ;
- ne configurez jamais la racine d'un serveur MCP « filesystem » sur votre répertoire personnel sans exclusion explicite de `~/.freebox-mcp/` ;
- en alternative, fournissez le token via les variables d'environnement `FREEBOX_APP_TOKEN` / `FREEBOX_APP_ID` (aucun fichier n'est alors écrit sur le disque) ;
- ne partagez ni ne committez jamais ce fichier.

### Révoquer l'accès

Si le token a fuité (ou en cas de doute), révoquez-le immédiatement depuis l'interface web Freebox OS :

**Freebox OS → Paramètres de la Freebox → Gestion des accès → onglet « Applications » → sélectionnez l'application → Supprimer / révoquer.**

Le token est alors invalidé côté Freebox. Supprimez ensuite `~/.freebox-mcp/credentials.json` et relancez `freebox_register_app` pour ré-autoriser l'application (revalidation physique sur l'écran LCD).

C'est également depuis cet écran que vous pouvez restreindre les permissions accordées à l'application (par exemple retirer « Modification des réglages » ou « Accès aux fichiers ») afin de limiter l'impact d'une fuite.

## Sécurité & Vie Privée

Autres mesures en place :

- Les tokens locaux sont stockés avec des permissions restreintes (`0o600`) — voir toutefois l'avertissement ci-dessus.
- Les actions les plus sensibles exigent une **phrase de confirmation explicite** passée en paramètre `confirm`, vérifiée côté serveur (et non seulement un « hint » MCP), afin qu'une injection de prompt ne puisse pas les déclencher seule :
  - `freebox_reboot` → `JE-CONFIRME-LE-REBOOT`
  - `freebox_fs_delete` → `JE-CONFIRME-LA-SUPPRESSION`
  - `freebox_port_forwarding_add` → `JE-CONFIRME-OUVERTURE-PORT`
  - `freebox_connection_config_update` (activation de `remote_access` / `api_remote_access`) → `JE-CONFIRME-EXPOSER-MA-FREEBOX`
  - `freebox_dhcp_config_update` (changement de `dns`) → `JE-CONFIRME-LE-CHANGEMENT-DNS`
- La clé WPA (`config.key`) n'est **jamais** renvoyée par `freebox_wifi_bss_list` : la réponse est construite à partir d'une liste blanche de champs non sensibles.
- `freebox_download_add` refuse les URL pointant vers des adresses privées, loopback ou link-local (protection SSRF).
- La découverte se fait **en HTTPS uniquement**. Le repli silencieux en HTTP a été supprimé ; il faut désormais opter explicitement pour `FREEBOX_ALLOW_INSECURE_HTTP=1`. Le champ `api_domain` renvoyé par la découverte est validé (`.fbxos.fr` / `.freebox.fr`).
- Les corps de réponse bruts de l'API ne sont plus renvoyés dans les messages d'erreur MCP : ils sont écrits sur `stderr` pour le débogage local uniquement.
- Optionnel : `FREEBOX_FS_ALLOWED_ROOTS` (liste de chemins séparés par des virgules) confine les outils `freebox_fs_*` à ces racines. Les chemins contenant `..` sont refusés dans tous les cas.
- Optionnel : `--toolsets=…` ou `FREEBOX_TOOLSETS` n'expose que certains groupes d'outils (par exemple `call,contact` pour un assistant téléphonie). Les droits de l'application dans Freebox OS restent le vrai contrôle pour les écritures, mais la lecture des réglages (hôtes LAN, WiFi, baux DHCP…) est toujours autorisée par la Freebox : ne pas enregistrer un outil est le seul moyen d'en priver un assistant.
- L'authentification utilise la méthode officielle HMAC-SHA1 Challenge. Aucun mot de passe maître n'est stocké.

### Variables d'environnement

| Variable | Effet |
| --- | --- |
| `FREEBOX_HOST` | Hôte de découverte (défaut : `mafreebox.freebox.fr`). |
| `FREEBOX_ALLOW_INSECURE_HTTP` | `1` autorise le repli en HTTP en clair si HTTPS échoue. **Déconseillé.** |
| `FREEBOX_FS_ALLOWED_ROOTS` | Racines autorisées pour les outils fichiers, séparées par des virgules. |
| `FREEBOX_APP_TOKEN` / `FREEBOX_APP_ID` | Fournir le token par l'environnement au lieu du fichier `credentials.json`. |
| `FREEBOX_TOOLSETS` | Groupes d'outils à exposer, séparés par des virgules (défaut : tous). L'argument `--toolsets=` a le même effet et prime sur la variable. Groupes : `auth`, `system`, `connection`, `wifi`, `lan`, `dhcp`, `downloads`, `filesystem`, `network`, `freeplug`, `parental`, `vpn-server`, `vpn-client`, `upnp`, `netshare`, `ftp`, `tftp`, `sfp`, `call`, `contact`. Un nom inconnu arrête le serveur. |

## Historique des versions & suivi

Le détail de chaque version se trouve dans les [GitHub Releases](https://github.com/loopion/freebox-mcp-server/releases).
Les domaines API Freebox pas encore couverts (téléphonie, domotique, stockage, multimédia, etc.) sont suivis dans [ROADMAP.md](ROADMAP.md).

## Licence
MIT License.
