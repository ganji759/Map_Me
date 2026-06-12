FROM node:20-slim
RUN npm install -g mongodb-mcp-server
EXPOSE 3100
CMD ["mongodb-mcp-server", "--transport", "http", "--httpPort", "3100"]
