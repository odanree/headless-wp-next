<?php
/**
 * Plugin Name:  Headless WP — Members API
 * Description:  Registers a "Member Article" custom post type and exposes it via
 *               a Bearer-token-protected REST API endpoint for a Next.js frontend.
 * Version:      1.0.0
 * Requires PHP: 7.4
 *
 * Setup:
 *   1. Copy to wp-content/plugins/headless-wp-members/headless-wp-members.php
 *   2. Activate via WP Admin → Plugins
 *   3. Add to wp-config.php:
 *        define( 'HEADLESS_API_TOKEN', 'your-secret-token' );
 *   4. Set WORDPRESS_API_TOKEN=your-secret-token in Next.js .env.local
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ─── Custom Post Type ─────────────────────────────────────────────────────────

add_action( 'init', 'hwp_register_member_article_cpt' );

function hwp_register_member_article_cpt(): void {
    register_post_type( 'member_article', [
        'label'               => 'Member Articles',
        'public'              => false,   // not in sitemaps or public archives
        'show_ui'             => true,    // visible in WP Admin
        'show_in_rest'        => false,   // NOT via core REST — use our custom endpoint
        'supports'            => [ 'title', 'editor', 'excerpt', 'custom-fields' ],
        'menu_icon'           => 'dashicons-lock',
        'capability_type'     => 'post',
        'rewrite'             => false,
    ] );
}

// ─── REST API ─────────────────────────────────────────────────────────────────

add_action( 'rest_api_init', 'hwp_register_rest_routes' );

function hwp_register_rest_routes(): void {
    $namespace = 'headless/v1';

    // GET /wp-json/headless/v1/articles
    register_rest_route( $namespace, '/articles', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'hwp_get_articles',
        'permission_callback' => 'hwp_check_bearer_token',
        'args'                => [
            'page'     => [ 'default' => 1,  'sanitize_callback' => 'absint' ],
            'per_page' => [ 'default' => 10, 'sanitize_callback' => 'absint' ],
        ],
    ] );

    // GET /wp-json/headless/v1/articles/{id}
    register_rest_route( $namespace, '/articles/(?P<id>\d+)', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'hwp_get_article',
        'permission_callback' => 'hwp_check_bearer_token',
        'args'                => [
            'id' => [
                'validate_callback' => fn( $v ) => is_numeric( $v ),
                'sanitize_callback' => 'absint',
            ],
        ],
    ] );

    // GET /wp-json/headless/v1/articles/public
    // Public teaser endpoint — no auth required.
    // Returns title, excerpt, date, readTime, category for the home page.
    // Full content is intentionally omitted — only authenticated members
    // (via /articles and /articles/{id}) can access it.
    register_rest_route( $namespace, '/articles/public', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'hwp_get_public_articles',
        'permission_callback' => '__return_true',
        'args'                => [
            'page'     => [ 'default' => 1,  'sanitize_callback' => 'absint' ],
            'per_page' => [ 'default' => 10, 'sanitize_callback' => 'absint' ],
        ],
    ] );

    // POST /wp-json/headless/v1/grant-membership
    // Called by the Next.js Stripe webhook (checkout.session.completed).
    // Finds or creates a WP user by email and assigns the member role.
    // Protected by the same Bearer token as the article endpoints.
    register_rest_route( $namespace, '/grant-membership', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'hwp_grant_membership',
        'permission_callback' => 'hwp_check_bearer_token',
        'args'                => [
            'email'             => [ 'required' => true,  'sanitize_callback' => 'sanitize_email' ],
            'stripe_session_id' => [ 'required' => true,  'sanitize_callback' => 'sanitize_text_field' ],
        ],
    ] );
}

// ─── Permission callback ──────────────────────────────────────────────────────

function hwp_check_bearer_token( WP_REST_Request $request ): bool|WP_Error {
    $secret = defined( 'HEADLESS_API_TOKEN' ) ? HEADLESS_API_TOKEN : '';

    if ( ! $secret ) {
        return new WP_Error( 'no_token_configured', 'API token not configured.', [ 'status' => 500 ] );
    }

    $auth   = $request->get_header( 'Authorization' );
    $token  = '';

    if ( $auth && stripos( $auth, 'Bearer ' ) === 0 ) {
        $token = trim( substr( $auth, 7 ) );
    }

    // hash_equals prevents timing attacks
    if ( ! hash_equals( $secret, $token ) ) {
        return new WP_Error( 'unauthorized', 'Invalid or missing API token.', [ 'status' => 401 ] );
    }

    return true;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function hwp_get_articles( WP_REST_Request $request ): WP_REST_Response {
    $page     = $request->get_param( 'page' );
    $per_page = min( $request->get_param( 'per_page' ), 100 );

    $query = new WP_Query( [
        'post_type'      => 'member_article',
        'post_status'    => 'publish',
        'posts_per_page' => $per_page,
        'paged'          => $page,
        'orderby'        => 'date',
        'order'          => 'DESC',
    ] );

    $articles = array_map( 'hwp_format_article', $query->posts );

    $response = new WP_REST_Response( [
        'articles'   => $articles,
        'total'      => (int) $query->found_posts,
        'totalPages' => (int) $query->max_num_pages,
    ], 200 );

    $response->header( 'X-WP-Total',      (string) $query->found_posts );
    $response->header( 'X-WP-TotalPages', (string) $query->max_num_pages );

    return $response;
}

function hwp_get_public_articles( WP_REST_Request $request ): WP_REST_Response {
    $page     = $request->get_param( 'page' );
    $per_page = min( $request->get_param( 'per_page' ), 100 );

    $query = new WP_Query( [
        'post_type'      => 'member_article',
        'post_status'    => 'publish',
        'posts_per_page' => $per_page,
        'paged'          => $page,
        'orderby'        => 'date',
        'order'          => 'DESC',
    ] );

    $articles = array_map( 'hwp_format_article_teaser', $query->posts );

    $response = new WP_REST_Response( [
        'articles'   => $articles,
        'total'      => (int) $query->found_posts,
        'totalPages' => (int) $query->max_num_pages,
    ], 200 );

    $response->header( 'X-WP-Total',      (string) $query->found_posts );
    $response->header( 'X-WP-TotalPages', (string) $query->max_num_pages );

    return $response;
}

function hwp_get_article( WP_REST_Request $request ): WP_REST_Response|WP_Error {
    $post = get_post( $request->get_param( 'id' ) );

    if ( ! $post || $post->post_type !== 'member_article' || $post->post_status !== 'publish' ) {
        return new WP_Error( 'not_found', 'Article not found.', [ 'status' => 404 ] );
    }

    return new WP_REST_Response( hwp_format_article( $post ), 200 );
}

// ─── Serializer ───────────────────────────────────────────────────────────────

function hwp_format_article( WP_Post $post ): array {
    // Only expose whitelisted fields — never json_encode the whole WP_Post object.
    $read_time = (int) get_post_meta( $post->ID, 'read_time', true );
    $category  = (string) get_post_meta( $post->ID, 'article_category', true );

    return [
        'id'       => $post->ID,
        'slug'     => $post->post_name,
        'title'    => wp_strip_all_tags( $post->post_title ),
        'excerpt'  => wp_strip_all_tags( $post->post_excerpt ?: wp_trim_words( $post->post_content, 30 ) ),
        'content'  => wp_kses_post( $post->post_content ),
        'date'     => get_the_date( 'c', $post ),
        'readTime' => $read_time ?: hwp_estimate_read_time( $post->post_content ),
        'category' => $category ?: 'General',
    ];
}

function hwp_estimate_read_time( string $content ): int {
    $word_count = str_word_count( wp_strip_all_tags( $content ) );
    return max( 1, (int) ceil( $word_count / 200 ) ); // ~200 wpm
}

// Teaser serializer — omits full content so unauthenticated callers
// can render the public listing without access to member-only body text.
function hwp_format_article_teaser( WP_Post $post ): array {
    $read_time = (int) get_post_meta( $post->ID, 'read_time', true );
    $category  = (string) get_post_meta( $post->ID, 'article_category', true );

    return [
        'id'       => $post->ID,
        'slug'     => $post->post_name,
        'title'    => wp_strip_all_tags( $post->post_title ),
        'excerpt'  => wp_strip_all_tags( $post->post_excerpt ?: wp_trim_words( $post->post_content, 30 ) ),
        'date'     => get_the_date( 'c', $post ),
        'readTime' => $read_time ?: hwp_estimate_read_time( $post->post_content ),
        'category' => $category ?: 'General',
        // 'content' deliberately excluded — full body requires Bearer token auth
    ];
}

// ─── On-demand revalidation trigger ──────────────────────────────────────────
// When an article is saved, ping the Next.js revalidation endpoint.

add_action( 'save_post_member_article', 'hwp_trigger_revalidation', 10, 2 );

function hwp_trigger_revalidation( int $post_id, WP_Post $post ): void {
    if ( $post->post_status !== 'publish' ) return;

    $next_url = defined( 'NEXT_REVALIDATE_URL' ) ? NEXT_REVALIDATE_URL : '';
    $secret   = defined( 'REVALIDATION_SECRET' ) ? REVALIDATION_SECRET : '';

    if ( ! $next_url || ! $secret ) return;

    // Bust all three cache layers in one request:
    //  - 'articles'         → member article list (TTL 300 s)
    //  - 'public-articles'  → public teaser list  (TTL 3600 s)
    //  - 'article-{id}'     → individual article page (TTL 300 s)
    // The Next.js `/api/revalidate` route accepts a `tags` array so all
    // three are purged atomically without three round-trips.
    wp_remote_post( $next_url, [
        'headers'    => [ 'Content-Type' => 'application/json' ],
        'body'       => wp_json_encode( [
            'secret' => $secret,
            'tags'   => [ 'articles', 'public-articles', 'article-' . $post_id ],
        ] ),
        'timeout'    => 5,
        'blocking'   => false, // fire and forget — never block the WP save request
    ] );
}

// ─── Stripe membership fulfillment ───────────────────────────────────────────
// Called by POST /api/webhooks/stripe in the Next.js app after a successful
// checkout.session.completed event. Finds or creates a WP user, grants the
// member role, and stores the Stripe session ID for audit.

function hwp_grant_membership( WP_REST_Request $request ): WP_REST_Response|WP_Error {
    $email      = $request->get_param( 'email' );
    $session_id = $request->get_param( 'stripe_session_id' );

    if ( ! is_email( $email ) ) {
        return new WP_Error( 'invalid_email', 'Invalid email address.', [ 'status' => 400 ] );
    }

    // Find existing user or create a new one.
    // wp_create_user() generates a random password — users join via Stripe,
    // not the WP login form, so no plain-text password is stored or sent.
    $user = get_user_by( 'email', $email );
    if ( ! $user ) {
        $user_id = wp_create_user( $email, wp_generate_password( 24, true, true ), $email );
        if ( is_wp_error( $user_id ) ) {
            return new WP_Error(
                'user_create_failed',
                $user_id->get_error_message(),
                [ 'status' => 500 ]
            );
        }
        $user = get_user_by( 'id', $user_id );
    }

    // Assign the subscriber role (members can read protected content).
    // Role is idempotent — safe to call on repeat webhook deliveries.
    $user->set_role( 'subscriber' );

    // Store Stripe session for audit trail — enables refund/revoke lookups.
    update_user_meta( $user->ID, 'stripe_session_id',      $session_id );
    update_user_meta( $user->ID, 'membership_granted_at',  current_time( 'mysql' ) );

    return new WP_REST_Response( [
        'user_id' => $user->ID,
        'email'   => $email,
        'role'    => 'subscriber',
        'granted' => true,
    ], 200 );
}
