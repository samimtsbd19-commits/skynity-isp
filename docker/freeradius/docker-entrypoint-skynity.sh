#!/bin/sh
set -e
# Expand DB_* and RADIUS_LOCALHOST_SECRET into live config before the
# vendor entrypoint copies /etc/raddb → /opt/etc/raddb.
# Use envsubst with an explicit variable list so FreeRADIUS ${modconfdir} etc.
# in the same files are left untouched.
: "${DB_PORT:=3306}"
export DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME RADIUS_LOCALHOST_SECRET
_SUBST='$DB_HOST $DB_PORT $DB_USER $DB_PASSWORD $DB_NAME $RADIUS_LOCALHOST_SECRET'
if [ -f /etc/raddb/mods-available/sql.envsubst ]; then
  envsubst "$_SUBST" < /etc/raddb/mods-available/sql.envsubst > /etc/raddb/mods-available/sql
fi
if [ -f /etc/raddb/clients.conf.envsubst ]; then
  envsubst "$_SUBST" < /etc/raddb/clients.conf.envsubst > /etc/raddb/clients.conf
fi
if id radius >/dev/null 2>&1; then
  chown radius:radiu /etc/raddb/mods-available/sql /etc/raddb/clients.conf 2>/dev/null || true
  chmod 640 /etc/raddb/mods-available/sql /etc/raddb/clients.conf 2>/dev/null || true
fi
exec /docker-entrypoint.sh "$@"
