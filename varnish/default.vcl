vcl 4.1;

# Varnish 7.3 origin page cache for the headless-wp-next WordPress backend.
# Sits between Next.js (fetch client) and Apache — the same shape
# production headless stacks run behind their CDN layer: origin-side
# coalescing + grace so a TTL expiry never stampedes MySQL.
#
# Layering, top-down:
#
#   Vercel Edge (Next.js ISR, per-tag)
#        ↓ POST /api/revalidate → fires PURGE here
#   Varnish 7.3  (this file)  ← grace 60s, coalescing on, PURGE ACL
#        ↓ backend `wp`
#   Apache + WordPress
#        ↓ Redis object cache (L1 in the WP process)
#        ↓ MySQL (writes only under normal load)

import std;

backend wp {
    .host = "wordpress";
    .port = "80";
    .connect_timeout = 2s;
    .first_byte_timeout = 10s;
    .between_bytes_timeout = 5s;
}

# PURGE is only allowed from the docker-compose private network + localhost.
# Never expose Varnish's admin port publicly — this ACL is the trust boundary.
acl purgers {
    "127.0.0.1";
    "localhost";
    "172.16.0.0"/12;   # docker default bridge range
    "10.0.0.0"/8;      # kubernetes overlays if we ever hoist this
    "192.168.0.0"/16;
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

sub vcl_hit {
    # Serve stale objects during grace window — the classic request-coalescing
    # + stale-while-revalidate pattern. One request refetches, everyone else
    # gets the stale copy immediately. Prevents thundering herd on TTL expiry.
    if (obj.ttl >= 0s) {
        return (deliver);
    }
    if (obj.ttl + obj.grace > 0s) {
        return (deliver);
    }
    return (miss);
}

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
