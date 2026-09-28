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
- Player — liste, état, volume/sourdine, contrôle média, ouverture de chaîne ou d'URL
- Réseau avancé — port forwarding, switch, contrôle parental (profils, règles),
  freeplug (CPL), VPN serveur/client, UPnP IGD/AV, partage réseau (Samba/AFP),
  FTP, TFTP, SFP *(v1.1.0, 51 nouveaux tools)*
- System (info, reboot)
- TV — chaînes du bouquet, guide des programmes (EPG), programmes à l'antenne, fiche programme
- Téléphonie — journal d'appels (liste, consultation, marquage lu, suppression
  unitaire/globale), compte téléphonique, messagerie vocale (liste, consultation,
  marquage lu, suppression), carnet de contacts (CRUD contact + numéros, emails,
  adresses, URLs) *(v1.2.0, 21 nouveaux tools)*
- WiFi (config, access points, BSS, stations, toggle)
- Wake-on-LAN

## À planifier — prochaines versions

### Domotique
- [ ] `home` — Home Automation complet: nodes, adapters, endpoints, pairing, tileset
      (pilotage volets, capteurs, alarme via app tierces)

### Stockage
- [ ] `storage` — disques (SMART, format), partitions (check/resize), RAID (create/repair/spares)

### Multimédia / TV *(dépend du matériel possédé)*
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

1. `home` — domotique
2. `storage` — disques / SMART
3. `rrd` — métriques

Le reste (`pvr`, `camera`, `lcd`, `ledstrip`) dépend du matériel
possédé (Player, caméra, Ultra) — à traiter à la demande.
