#!/bin/sh
set -e

: "${VERSION:=unknown}"
: "${COLOR:=unset}"
: "${POD_IP:=unknown}"

envsubst '\$VERSION \$COLOR \$POD_IP' < /usr/share/nginx/html/index.html.tpl > /usr/share/nginx/html/index.html

# Start nginx in foreground (logs will go to stdout/stderr as configured)
exec nginx -g 'daemon off;'
