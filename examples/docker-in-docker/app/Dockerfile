FROM alpine:3.22

COPY message.txt /message.txt

RUN test -s /message.txt

USER 65534:65534
CMD ["sh", "-ec", "test ! -e /var/run/docker.sock; test ! -e /workspace; test ! -e /root/.docker/config.json; cat /message.txt"]
