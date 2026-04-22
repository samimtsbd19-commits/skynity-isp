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

# Dict / SQL module / site / clients overlay
COPY raddb/ /etc/raddb/

# Permissions: FreeRADIUS runs as radiusd and MUST own its config
RUN set -eux; \
    chown -R radiusd:radiusd /etc/raddb; \
    chmod 640 /etc/raddb/clients.conf /etc/raddb/mods-available/sql 2>/dev/null || true; \
    # Enable the SQL module + Skynity site (symlinks)
    ln -sf /etc/raddb/mods-available/sql   /etc/raddb/mods-enabled/sql; \
    ln -sf /etc/raddb/sites-available/skynity /etc/raddb/sites-enabled/skynity; \
    # The stock "default" / "inner-tunnel" sites are redundant for us.
    rm -f /etc/raddb/sites-enabled/default /etc/raddb/sites-enabled/inner-tunnel 2>/dev/null || true

# Standard RADIUS ports
EXPOSE 1812/udp
EXPOSE 1813/udp
EXPOSE 3799/udp

# -X keeps FreeRADIUS in the foreground with debug logging on
# stdout, which is exactly what `docker compose logs freeradius`
# expects. Flip to -f (no debug) once the deployment is stable.
CMD ["radiusd", "-X", "-f"]
