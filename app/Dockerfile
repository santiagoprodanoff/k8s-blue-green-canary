FROM nginx:1.29.3-alpine

RUN apk add --no-cache gettext

COPY index.html.template /usr/share/nginx/html/index.html.tpl

COPY default.conf /etc/nginx/conf.d/default.conf

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]