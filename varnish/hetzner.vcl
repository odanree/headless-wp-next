vcl 4.1;

# Varnish 7.1 origin page cache — PRODUCTION topology (Hetzner VPS).
# Same policy as varnish/default.vcl; only the backend block differs.
# See .github/workflows/deploy-varnish-hetzner.yml — this file is what
# GitHub Actions scps to /etc/varnish/default.vcl on the VPS.
#
# Layering, top-down:
#
#   Vercel Edge (Next.js ISR, per-tag)
#        ↓ POST /api/revalidate → fires PURGE here
#   Varnish 7.1  (this file, listening on :80 on the Hetzner VPS)
#        ↓ backend `wp` = Apache on the same host, loopback :8080
#   Apache + WordPress
#        ↓ Redis object cache (L1 in the WP process)
#        ↓ MySQL (writes only under normal load)

import std;

# Backend = portfolio-wordpress container on the shared portfolio-net.
# Docker DNS resolves `wordpress` to the WP container's network IP. Same
# service-discovery-via-container-name shape that portfolio-caddy already
# uses. No host-loopback hop; both containers on the same L2 network.
backend wp {
    .host = "wordpress";
    .port = "80";
    .connect_timeout = 2s;
    .first_byte_timeout = 10s;
    .between_bytes_timeout = 5s;
}

# PURGE/BAN reach Varnish through portfolio-caddy (the L7 edge). Caddy
# forwards the request with its own docker-network IP as the source, so
# the ACL accepts RFC1918 ranges that Docker default bridge networks use.
# This is a routing-level trust boundary — the real authenticity check
# lives one layer up: Next.js /api/revalidate verifies a shared secret
# before firing the BAN, and Caddy (public-facing) is the only path into
# the docker network from outside.
acl purgers {
    "127.0.0.1";
    "localhost";
    "172.16.0.0"/12;    # docker default bridge range (covers portfolio-net + friends)
    "10.0.0.0"/8;       # overlay / swarm networks if this stack ever hoists there
    "192.168.0.0"/16;   # user-defined bridge networks
}

sub vcl_recv {
    # PURGE-by-URL: Next.js's revalidate route fires this after revalidateTag()
    # so the origin cache and the edge cache drop stale copies together.
    if (req.method == "PURGE") {
        if (!client.ip ~ purgers) {
            return (synth(405, "Not allowed"));
        }
        return (purge);
    }

    # BAN-by-tag: for wildcard invalidation (e.g. every article at once),
    # send `BAN` with an `X-Cache-Tag` header. Ban lurker sweeps them out.
    if (req.method == "BAN") {
        if (!client.ip ~ purgers) {
            return (synth(405, "Not allowed"));
        }
        if (req.http.X-Cache-Tag) {
            ban("obj.http.X-Cache-Tag ~ " + req.http.X-Cache-Tag);
            return (synth(200, "Banned"));
        }
        return (synth(400, "X-Cache-Tag required"));
    }

    # WP REST API responses are safe to cache — the plugin sets Bearer auth
    # on the fetch client, but the response body has no per-user data.
    # Strip cookies so Varnish doesn't hash the object per session.
    if (req.url ~ "^/wp-json/") {
        unset req.http.Cookie;
        unset req.http.Authorization;
        return (hash);
    }

    # Never cache wp-admin / wp-login / preview endpoints.
    if (req.url ~ "^/wp-admin" || req.url ~ "^/wp-login" || req.url ~ "preview=true") {
        return (pass);
    }

    # Anything with a WP auth cookie bypasses the cache — logged-in editors
    # must see live data, not a stale public copy.
    if (req.http.Cookie ~ "(wordpress_logged_in|wp-postpass|comment_author)") {
        return (pass);
    }
}

sub vcl_backend_response {
    # Default TTL for cacheable REST endpoints. Next.js's ISR revalidate
    # window is the source of truth — this is defence-in-depth for when
    # the edge cache misses and hammers the origin.
    if (bereq.url ~ "^/wp-json/") {
        set beresp.ttl = 5m;
        set beresp.grace = 60s;      # serve stale for up to 60s while a
                                     # single request refetches in background
        unset beresp.http.Set-Cookie;
    }

    # If the backend emitted an X-Cache-Tag header, keep it so BAN can match.
    # The WP plugin's revalidate hook can populate this on save_post.
    # (Header stays out of the client response — Next.js reads JSON only.)
}

# NOTE: We don't override vcl_hit. Varnish 7's built-in vcl_hit already
# implements the request-coalescing + stale-while-revalidate pattern when
# beresp.grace is set in vcl_backend_response (above): if the object is
# fresh → deliver; if stale but within grace → deliver stale while a single
# fetch refreshes in the background; if past grace → fetch. That's exactly
# what we want. Custom vcl_hit was a Varnish-4-ism (return (miss) is no
# longer a valid action in 7.x).

sub vcl_deliver {
    # Cache-hit visibility for debugging + PR screenshots.
    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
        set resp.http.X-Cache-Hits = obj.hits;
    } else {
        set resp.http.X-Cache = "MISS";
    }
    # Never leak the internal cache-tag header to the client.
    unset resp.http.X-Cache-Tag;
}
