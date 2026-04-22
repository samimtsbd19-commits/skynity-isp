# ============================================================
# Skynity ISP — FreeRADIUS 3.2 with MySQL backend
# ------------------------------------------------------------
# Builds on the official image and overlays Skynity's raddb
# tree so the container starts with SQL authentication + SQL
# accounting + SQL clients already enabled against the shared
# `skynity` MySQL database.
#
# The official image ships a full raddb tree at /etc/raddb.
# Our overlay replaces only the files we care about; everything
# else (users, eap, dhcp, etc.) keeps the vendor defaults.
# ============================================================
# Hub tags use full patch versions (e.g. 3.2.8-alpine); `3.2-alpine` is not published.
FROM freeradius/freeradius-server:3.2.8-alpine

# gettext: envsubst for sql/clients templates.
# mariadb-connector-c: libmariadb.so.3 for rlm_sql_mysql (not in slim base image).
RUN apk add --no-cache gettext mariadb-connector-c

COPY docker-entrypoint-skynity.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint-skynity.sh

# Dict / SQL module / site / clients overlay
COPY raddb/ /etc/raddb/

# The Hub `*-alpine` image often has no passwd entries for radius*; create the
# standard Alpine account, then match Debian/RHEL names if present.
RUN set -eux; \
    if ! id radius >/dev/null 2>&1 && ! id freerad >/dev/null 2>&1 && ! id radiusd >/dev/null 2>&1; then \
      addgroup -S radius; \
      adduser -S -D -H -h /etc/raddb -G radius radius; \
    fi; \
    OWNER=; \
    for U in radius freerad radiusd; do \
      if id -u "$U" >/dev/null 2>&1; then OWNER=$U; break; fi; \
    done; \
    if [ -z "$OWNER" ]; then echo "Could not resolve FreeRADIUS UNIX user"; exit 1; fi; \
    chown -R "$OWNER:$OWNER" /etc/raddb; \
    chmod 640 /etc/raddb/clients.conf.envsubst /etc/raddb/mods-available/sql.envsubst 2>/dev/null || true; \
    # Enable the SQL module + Skynity site (symlinks)
    ln -sf /etc/raddb/mods-available/sql   /etc/raddb/mods-enabled/sql; \
    ln -sf /etc/raddb/sites-available/skynity /etc/raddb/sites-enabled/skynity; \
    # The stock "default" / "inner-tunnel" sites are redundant for us.
    rm -f /etc/raddb/sites-enabled/default /etc/raddb/sites-enabled/inner-tunnel 2>/dev/null || true; \
    # EAP requires Auth-Type EAP in a virtual server; we only use PAP/CHAP/MS-CHAP for NAS.
    rm -f /etc/raddb/mods-enabled/eap 2>/dev/null || true

# Standard RADIUS ports
EXPOSE 1812/udp
EXPOSE 1813/udp
EXPOSE 3799/udp

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-skynity.sh"]

# -X keeps FreeRADIUS in the foreground with debug logging on
# stdout, which is exactly what `docker compose logs freeradius`
# expects. Flip to -f (no debug) once the deployment is stable.
CMD ["radiusd", "-X", "-f"]
