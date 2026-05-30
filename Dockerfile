FROM php:8.2-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        default-mysql-client \
        libonig-dev \
        libzip-dev \
        openssl \
        unzip \
    && docker-php-ext-install mysqli mbstring zip \
    && a2enmod rewrite ssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

COPY . /var/www/html
COPY docker/apache/integram.conf /etc/apache2/sites-available/000-default.conf
COPY docker/entrypoint.sh /usr/local/bin/integram-entrypoint
COPY docker/mysql/010-integram-bootstrap.sql /usr/local/share/integram/010-integram-bootstrap.sql

RUN mkdir -p \
        /usr/local/share/integram/download-seed \
        /usr/local/share/integram/templates-custom-seed/my \
        /usr/local/share/integram/templates-custom-seed/ru \
        /usr/local/share/integram/templates-custom-seed/en \
        /var/www/html/logs \
        /var/www/html/templates/custom \
        /var/www/html/download \
    && cp -a /var/www/html/download/. /usr/local/share/integram/download-seed/ \
    && cp -a /var/www/html/templates/my/. /usr/local/share/integram/templates-custom-seed/my/ \
    && cp -a /var/www/html/templates/ru/. /usr/local/share/integram/templates-custom-seed/ru/ \
    && cp -a /var/www/html/templates/ru/. /usr/local/share/integram/templates-custom-seed/en/ \
    && chmod +x /usr/local/bin/integram-entrypoint \
    && chown -R www-data:www-data /var/www/html/logs /var/www/html/templates /var/www/html/download

ENTRYPOINT ["integram-entrypoint"]
CMD ["apache2-foreground"]
