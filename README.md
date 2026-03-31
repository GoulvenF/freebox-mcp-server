<p align="center">
  <img src="logo.svg" alt="Freebox MCP Logo" width="100"/>
</p>

# Freebox MCP Server

**Serveur MCP pour l'API Freebox OS - Contrôlez votre Freebox Server directement depuis les assistants IA compatibles MCP (Claude, Cursor, etc.). Créé par loopion.**

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

---

## 🚀 Installation & Utilisation

Assurez-vous d'avoir **Node.js 18+** installé sur votre machine.

### Installation via npm (Standard)

```bash
# Lance et télécharge le serveur automatiquement à l'aide de npx
npx -y freebox-mcp-server
```

### 1. Configuration sur Claude Desktop

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

### 2. Configuration sur Claude Code (CLI)

Depuis votre terminal, ajoutez directement le serveur :

```bash
claude mcp add freebox npx -y freebox-mcp-server
```

---

## Sécurité & Vie Privée

Ce serveur est conçu avec la sécurité à l'esprit :
- Les tokens locaux sont correctement stockés avec des permissions restreintes d'accès (`0o600`).
- Les commandes destructives (suppression de fichiers `freebox_fs_delete`, `freebox_reboot`) sont signalées dans le SDK MCP pour demander une confirmation du client avant exécution.
- Les entrées de requêtes réseau (URL) sont sécurisées.
- L'authentification utilise la méthode officielle HMAC-SHA1 Challenge. Aucun mot de passe maitre n'est stocké.

## Licence
MIT License.
