# https://kracekumar.com/post/54437887454/ssl-for-flask-local-development/
cd cert
rm -f *.crt *.key* *.csr
openssl genrsa -des3 -out server.key 2048
openssl req -new -key server.key -out server.csr
cp server.key server.key.org
openssl rsa -in server.key.org -out server.key
openssl x509 -req -days 365 -in server.csr -signkey server.key -out server.crt
cd ..