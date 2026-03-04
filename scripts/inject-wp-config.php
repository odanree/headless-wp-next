<?php
$config = '/var/www/html/wp-config.php';
$content = file_get_contents($config);

if (strpos($content, 'HEADLESS_API_TOKEN') !== false) {
    echo "Constants already present.\n";
    exit(0);
}

$inject = "define( 'HEADLESS_API_TOKEN', 'local-dev-token' );\n"
        . "define( 'NEXT_REVALIDATE_URL', 'http://localhost:3004/api/revalidate' );\n"
        . "define( 'REVALIDATION_SECRET', 'local-revalidate-secret' );\n\n";

$marker = "/* That's all, stop editing!";
$content = str_replace($marker, $inject . $marker, $content);
file_put_contents($config, $content);
echo "Injected constants.\n";

// Verify
$verify = file_get_contents($config);
preg_match_all("/define\( '(HEADLESS_API_TOKEN|NEXT_REVALIDATE_URL|REVALIDATION_SECRET)'.+/", $verify, $matches);
foreach ($matches[0] as $line) {
    echo $line . "\n";
}
