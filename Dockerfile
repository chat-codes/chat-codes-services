FROM ubuntu:14.04.1
MAINTAINER swloney@gmail.com

# Install Node v6 and npm
RUN apt-get update
RUN apt-get install -y build-essential curl
RUN curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -
RUN apt-get install -y nodejs

ADD . /app

# Install Node modules
RUN cd /app; npm install .

# Expose port 3000 to the docker container server
EXPOSE 3000

# Start app
CMD ["nodejs", "/app/built/socketio_server.js"]