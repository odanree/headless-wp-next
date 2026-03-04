<?php
$htaccess = '/var/www/html/.htaccess';

// Write the full correct .htaccess. Uses a RewriteRule to pass the Authorization
// header to PHP — the most reliable approach across Apache versions.
$content = '# BEGIN WordPress
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteBase /
RewriteRule ^index\.php$ - [L]
# Pass Authorization header to PHP (Apache strips it by default)
RewriteCond %{HTTP:Authorization} .
RewriteRule ^ - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
</IfModule>
# END WordPress
';

file_put_contents($htaccess, $content);
echo "Written .htaccess:\n";
echo file_get_contents($htaccess);
