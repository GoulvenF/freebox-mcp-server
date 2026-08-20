# Roadmap — Freebox MCP Server

Suivi des domaines de l'API Freebox OS non encore couverts par le serveur MCP,
à intégrer au fil des prochaines versions (releases GitHub).

Référence documentation: FreeboxOS Gateway API (build `be37b212f`).

## Fait

- Auth (register app, login/session)
- Connection (status, config)
- DHCP (config, baux dynamiques/statiques)
- Downloads
- Filesystem
- LAN hosts
- Réseau avancé — port forwarding, switch, contrôle parental (profils, règles),
  freeplug (CPL), VPN serveur/client, UPnP IGD/AV, partage réseau (Samba/AFP),
  FTP, TFTP, SFP *(v1.1.0, 51 nouveaux tools)*
- System (info, reboot)
- WiFi (config, access points, BSS, stations, toggle)
- Wake-on-LAN

## À planifier — prochaines versions

### Téléphonie
- [ ] `call` — journal d'appels (list/get/update/delete, marquer lu, voicemail)
- [ ] `contact` — carnet de contacts (CRUD contact/numéro/email/adresse/url)

### Domotique
- [ ] `home` — Home Automation complet: nodes, adapters, endpoints, pairing, tileset
      (pilotage volets, capteurs, alarme via app tierces)

### Stockage
- [ ] `storage` — disques (SMART, format), partitions (check/resize), RAID (create/repair/spares)

### Multimédia / TV *(dépend du matériel possédé)*
- [ ] `player` — pilotage Freebox Player (volume, lecture média, status)
- [ ] `pvr` — enregistrements programmés/terminés, quota, config
- [ ] `airmedia` — récepteurs AirMedia, envoi de contenu
- [ ] `camera` — caméras IP Freebox (list, config)

### Système *(dépend du matériel — LCD, LED, Ultra)*
- [ ] `lcd` — config écran LCD façade
- [ ] `ledstrip` — bandeau LED (Ultra), planning
- [ ] `standby` — mode veille box
- [ ] `rrd` — métriques historiques (bande passante, température, etc.)
- [ ] `notif` — cibles de notifications push
- [ ] `share_link` — liens de partage de fichiers temporaires

## Priorisation suggérée

1. `contact` / `call` — carnet + journal d'appels
2. `home` — domotique
3. `storage` — disques / SMART
4. `rrd` — métriques

Le reste (`player`, `pvr`, `camera`, `lcd`, `ledstrip`) dépend du matériel
possédé (Player, caméra, Ultra) — à traiter à la demande.
