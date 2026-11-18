#!/bin/bash
set -euo pipefail
umask 077
mkdir -p /data/config /data/mongo /data/postgres /data/redis /data/objects /data/logs
node scripts/prepare-env.mjs
source /data/config/runtime.env
chown -R knowledge:knowledge /data/config /data/mongo /data/redis /data/objects /data/logs
chown postgres:postgres /data/postgres
if [ ! -f /data/postgres/PG_VERSION ]; then
  install -o postgres -g postgres -m 600 /data/config/pg-password /tmp/knowledge-pg-password
  runuser -u postgres -- /usr/lib/postgresql/17/bin/initdb -D /data/postgres --username=knowledge --pwfile=/tmp/knowledge-pg-password --auth-local=trust --auth-host=scram-sha-256
  rm -f /tmp/knowledge-pg-password
fi
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/knowledge.conf
