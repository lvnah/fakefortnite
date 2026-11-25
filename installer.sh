#!/usr/bin/env bash
# =============================================================================
# Battle Island — installation sur alwaysdata avec UN SEUL site, sans Service.
#
# Le site est de type « Programme utilisateur » et lance « php server.php ».
# Ce programme sert tout : la page du jeu, l'API (/api.php/…) et le temps réel (/ws).
# alwaysdata le démarre tout seul et le relance s'il s'arrête.
#
# Usage (terminal SSH alwaysdata) :  unzip -o fakeftn.zip && bash fakeftn/installer.sh
# =============================================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
REL="${DIR#$HOME/}"
API="${AD_API:-https://api.alwaysdata.com/v1}"
TMP="$(mktemp)"; SITES="$(mktemp)"
trap 'rm -f "$TMP" "$SITES"' EXIT
B='\033[1m'; G='\033[32m'; R='\033[31m'; Y='\033[33m'; N='\033[0m'

echo -e "${B}=== Battle Island — installation sur alwaysdata (un seul site) ===${N}"
echo "Dossier du jeu : $DIR"

# 1) vérifications locales -----------------------------------------------------
if ! command -v php >/dev/null 2>&1; then echo -e "${R}PHP est introuvable sur ce compte.${N}"; exit 1; fi
PHPV=$(php -r 'echo PHP_VERSION;')
if ! php -r 'exit(PHP_VERSION_ID >= 80100 ? 0 : 1);'; then
  echo -e "${R}PHP $PHPV est trop ancien : il faut PHP 8.1 ou plus.${N}"
  echo "Changez la version dans l'admin alwaysdata : Environnement > PHP, puis relancez ce script."
  exit 1
fi
for ext in pdo_sqlite mbstring; do
  if ! php -m | grep -qi "^$ext$"; then echo -e "${R}Extension PHP manquante : $ext${N}"; exit 1; fi
done
echo "PHP : $PHPV"
for f in public/index.html public/map/island.json server/server.php server/engine.php server/ws.php server/http.php server/routes.php server/db.php; do
  [ -f "$DIR/$f" ] || { echo -e "${R}Fichier manquant : $f${N}"; exit 1; }
done
mkdir -p "$DIR/server/data"

TP=$(( 8300 + RANDOM % 150 ))
(cd "$DIR/server" && IP=127.0.0.1 PORT=$TP exec php server.php) >/dev/null 2>&1 & PID=$!
sleep 2.5
if curl -s "http://127.0.0.1:$TP/ws" | grep -q '"ok":true' && curl -s "http://127.0.0.1:$TP/" | grep -qi 'battle island'; then
  echo -e "${G}✔ Le serveur démarre correctement (page + jeu).${N}"
else
  echo -e "${Y}(test local du serveur impossible, on continue)${N}"
fi
kill $PID >/dev/null 2>&1

# 2) paramètres ----------------------------------------------------------------
ACCOUNT_DEF="${ACCOUNT:-${USER%%_*}}"
read -r -p "Nom du compte alwaysdata [$ACCOUNT_DEF] : " A; ACCOUNT="${A:-$ACCOUNT_DEF}"
ADDR_DEF="$ACCOUNT.alwaysdata.net"
read -r -p "Adresse du jeu [$ADDR_DEF] : " A; ADDR="${A:-$ADDR_DEF}"
ADDR="${ADDR#http://}"; ADDR="${ADDR#https://}"; ADDR="${ADDR%%/*}"
CHECK="${AD_CHECK:-https://$ADDR}"
echo "Jeton d'API : admin alwaysdata > Profil > Jetons d'API > Ajouter (laisser vide pour configurer à la main)."
read -r -s -p "Jeton d'API : " TOKEN; echo

manual() {
  echo
  echo -e "${B}Configuration à la main (1 minute) : admin.alwaysdata.com > Web > Sites${N}"
  echo "  Modifiez le site $ADDR (crayon) :"
  echo "    • Type ................. Programme utilisateur"
  echo "    • Commande ............. php server.php"
  echo "    • Répertoire de travail  $REL/server/"
  echo "    • Onglet Avancé : durée d'inactivité à 0 (conseillé)"
  echo "  Enregistrez, puis ouvrez https://$ADDR"
  echo "  Vérification : https://$ADDR/ws doit afficher {\"ok\":true,...}"
}
[ -z "$TOKEN" ] && { manual; exit 0; }

AUTH="$TOKEN account=$ACCOUNT:"
call() { # méthode url [json] -> code HTTP, réponse dans $TMP
  curl -s -o "$TMP" -w "%{http_code}" -X "$1" --basic --user "$AUTH" \
    -H "Content-Type: application/json" -H "alwaysdata-synchronous: yes" ${3:+-d "$3"} "$2"
}
# "id type dossier" du site qui a exactement l'adresse $1
site_info() {
  php -r '
    $v = json_decode((string) file_get_contents($argv[1]), true);
    foreach (is_array($v) ? $v : [] as $s) {
      foreach (($s["addresses"] ?? []) as $a) {
        $a = is_array($a) ? ($a["name"] ?? "") : (string) $a;
        if (strtolower(rtrim($a, "/")) === strtolower($argv[2])) {
          $d = ($s["working_directory"] ?? "") ?: (($s["path"] ?? "") ?: "-");
          echo $s["id"], " ", $s["type"] ?? "?", " ", $d, "\n";
          exit;
        }
      }
    }' "$SITES" "$1"
}
confirm() { read -r -p "$1 [o/N] " OK; case "$OK" in o|O|oui|OUI|Oui) return 0;; *) return 1;; esac; }
ok() { case "$1" in 2*) return 0;; *) return 1;; esac; }
fail() { echo -e "${R}L'API a refusé : $1 (HTTP $2)${N}"; cat "$TMP"; echo; manual; exit 1; }

# 3) le site --------------------------------------------------------------------
CODE=$(call GET "$API/site/")
if [ "$CODE" != "200" ]; then echo -e "${R}Le jeton ou le nom de compte est refusé (HTTP $CODE).${N}"; cat "$TMP"; echo; manual; exit 1; fi
cp "$TMP" "$SITES"
read -r ID TYPE CUR <<< "$(site_info "$ADDR")"

MIN="\"type\":\"user_program\",\"command\":\"php server.php\",\"working_directory\":\"$REL/server/\""
FULL="$MIN,\"max_idle_time\":0"
IDLE_OK=1
if [ -n "$ID" ]; then
  if [ "$TYPE" != "user_program" ] || [ "${CUR%/}" != "$REL/server" ]; then
    echo "Le site n°$ID ($ADDR) est actuellement : type $TYPE, dossier $CUR"
    confirm "Il va devenir le jeu (Programme utilisateur, php server.php, dossier $REL/server/). Continuer ?" || { echo "Annulé."; exit 0; }
  fi
  CODE=$(call PATCH "$API/site/$ID/" "{$FULL}")
  if [ "$CODE" = "400" ]; then IDLE_OK=0; CODE=$(call PATCH "$API/site/$ID/" "{$MIN}"); fi
  ok "$CODE" || fail "configuration du site" "$CODE"
else
  CODE=$(call POST "$API/site/" "{\"name\":\"Battle Island\",$FULL,\"addresses\":[\"$ADDR\"]}")
  if [ "$CODE" = "400" ]; then IDLE_OK=0; CODE=$(call POST "$API/site/" "{$MIN,\"addresses\":[\"$ADDR\"]}"); fi
  ok "$CODE" || fail "création du site" "$CODE"
  call GET "$API/site/" >/dev/null; cp "$TMP" "$SITES"
  read -r ID TYPE CUR <<< "$(site_info "$ADDR")"
fi
echo -e "${G}✔ Site configuré : $ADDR (Programme utilisateur, php server.php).${N}"
[ "$IDLE_OK" = "0" ] && echo -e "${Y}À régler à la main (onglet Avancé du site) : durée d'inactivité à 0.${N}"
if [ -n "$ID" ]; then
  call POST "$API/site/$ID/restart/" >/dev/null && echo -e "${G}✔ Site redémarré.${N}"
fi

# 4) vérification en ligne -------------------------------------------------------
echo -n "Vérification de $CHECK "
for i in $(seq 1 20); do
  if curl -s "$CHECK/ws" | grep -q '"ok":true'; then
    echo
    echo -e "${G}✔ Serveur de jeu en ligne.${N}"
    if curl -s "$CHECK/api.php/skins" | grep -q '"skins"'; then echo -e "${G}✔ API en ligne.${N}"; else echo -e "${Y}L'API ne répond pas encore ($CHECK/api.php/skins).${N}"; fi
    echo -e "${G}${B}✔ C'est prêt : https://$ADDR${N}"
    echo "Envoyez ce lien à vos amis : même adresse = même partie."
    exit 0
  fi
  echo -n "."; sleep 3
done
echo
echo -e "${Y}Le site ne répond pas encore. Patientez une minute puis ouvrez https://$ADDR/ws${N}"
echo "(il doit afficher {\"ok\":true,...}). Journaux : ~/admin/logs/sites/"
