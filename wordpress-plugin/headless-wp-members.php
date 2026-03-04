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

    wp_remote_post( $next_url, [
        'headers'    => [ 'Content-Type' => 'application/json' ],
        'body'       => wp_json_encode( [ 'tag' => 'articles', 'secret' => $secret ] ),
        'timeout'    => 5,
        'blocking'   => false, // fire and forget
    ] );
}
