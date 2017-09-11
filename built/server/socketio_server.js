"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sio = require("socket.io");
const _ = require("underscore");
const commandLineArgs = require("command-line-args");
const fs = require("fs");
const path = require("path");
const pg = require("pg");
pg.defaults.ssl = true;
function getCredentials(filename = path.join(__dirname, 'db_creds.json')) {
    return new Promise((resolve, reject) => {
        fs.readFile(filename, 'utf-8', (err, contents) => {
            if (err) {
                reject(err);
            }
            resolve(contents);
        });
    }).then((contents) => {
        return JSON.parse(contents);
    });
}
class ChatCodesSocketIOServer {
    constructor(port, dbURL) {
        this.port = port;
        this.namespaces = {};
        this.members = {};
        this.tables = {
            'channels': [
                'id SERIAL PRIMARY KEY',
                'created TIMESTAMP',
                'destroyed TIMESTAMP',
                'name TEXT NOT NULL'
            ],
            'users': [
                'id SERIAL PRIMARY KEY',
                'uid TEXT NOT NULL',
                'channel_id INTEGER REFERENCES channels(id)',
                'name TEXT NOT NULL'
            ],
            'user_connections': [
                'user_id INTEGER REFERENCES users(id)',
                'channel_id INTEGER REFERENCES channels(id)',
                'time TIMESTAMP',
                'action TEXT'
            ],
            'channel_data': [
                'user_id INTEGER REFERENCES users(id)',
                'channel_id INTEGER REFERENCES channels(id)',
                'time TIMESTAMP',
                'event_name TEXT',
                'data TEXT'
            ]
        };
        let urlPromise;
        if (dbURL) {
            urlPromise = Promise.resolve(dbURL);
        }
        else {
            urlPromise = getCredentials();
        }
        this.clientPromise = urlPromise.then((dbURL) => {
            const client = new pg.Client({
                connectionString: dbURL
            });
            return client.connect().then(() => { return client; });
        }).then((client) => {
            return this.createTables(client);
        }).catch((err) => {
            console.error(err);
            return null;
        });
        // this.dropTables();
        this.io = sio(this.port);
        this.io.on('connection', (socket) => {
            const { id } = socket;
            socket.on('request-join-room', (roomName, callback) => {
                this.getNamespace(roomName);
                callback();
                console.log(`Client (${id}) requested to join ${roomName}`);
            });
            socket.on('channel-available', (roomName, callback) => {
                this.getMembers(roomName).then((members) => {
                    const nobodyThere = members.length === 0;
                    callback(nobodyThere);
                    console.log(`Telling (${id}) that ${roomName} is${nobodyThere ? " " : " not "}available`);
                });
                console.log(`Client (${id}) asked if ${roomName} is available`);
            });
            socket.on('ping', function (data, callback) {
                callback('pong', {
                    success: true,
                    received: data
                });
            });
            console.log(`Client connected (id: ${id})`);
        });
        console.log(`Created server on port ${port}`);
    }
    getNamespace(name) {
        if (!_.has(this.namespaces, name)) {
            this.namespaces[name] = this.createNamespace(name);
        }
        return this.namespaces[name];
    }
    ;
    shouldLogData(eventType, data) {
        if (eventType === 'typing' || eventType === 'cursor-event') {
            return false;
        }
        else {
            return true;
        }
    }
    createNamespace(name) {
        const ns = this.io.of(`/${name}`);
        const dbChannelID = this.clientPromise.then((client) => {
            console.log(`DB: Insert ${name} into channels`);
            return client.query(`INSERT INTO channels (name, created) VALUES ($1::text, now()) RETURNING id`, [name]);
        }).then((res) => {
            return res.rows[0].id;
        });
        ns.on('connection', (s) => {
            const { id } = s;
            let dbid;
            const member = {
                id: id,
                info: {
                    name: null
                }
            };
            this.members[id] = member;
            s.on('set-username', (username, callback) => {
                member.info.name = username;
                let client;
                let channelID;
                Promise.all([dbChannelID, this.clientPromise]).then((result) => {
                    channelID = result[0];
                    client = result[1];
                    console.log(`DB: Insert ${username} into users`);
                    return client.query(`INSERT INTO users (uid, name, channel_id) VALUES ($1::text, $2::text, $3::integer) RETURNING id`, [id, username, channelID]);
                }).then((res) => {
                    return res.rows[0].id;
                }).then((id) => {
                    dbid = id;
                    console.log(`DB: ${username} connected`);
                    return client.query(`INSERT INTO user_connections(user_id, channel_id, time, action) VALUES ($1::integer, $2::integer, now(), $3::text)`, [
                        dbid, channelID, 'connect'
                    ]);
                }).then(() => {
                    return this.getChannelState(channelID);
                }).then((channelState) => {
                    callback(_.extend({
                        myID: id
                    }, channelState));
                    s.broadcast.emit('member-added', member);
                    this.getChannelState(channelID);
                });
                console.log(`Client (${id} in ${name}) set username to ${username}`);
            });
            s.on('data', (eventName, payload) => {
                if (this.shouldLogData(eventName, payload)) {
                    Promise.all([dbChannelID, this.clientPromise]).then((result) => {
                        const channelID = result[0];
                        const client = result[1];
                        return client.query(`INSERT INTO channel_data (user_id, channel_id, time, data, event_name) VALUES ($1::integer, $2::integer, now(), $3::text, $4::text)`, [dbid, channelID, JSON.stringify(payload), eventName]);
                    });
                }
                s.broadcast.emit(`data-${eventName}`, payload);
            });
            s.on('disconnect', () => {
                Promise.all([dbChannelID, this.clientPromise, this.getMembers(name)]).then((result) => {
                    const channelID = result[0];
                    const client = result[1];
                    const members = result[2];
                    console.log(`DB: ${member.info.name} disconnected`);
                    const queries = [
                        client.query(`INSERT INTO user_connections(user_id, channel_id, time, action) VALUES ($1::integer, $2::integer, now(), $3::text)`, [
                            dbid, channelID, 'disconnect'
                        ])
                    ];
                    if (members.length === 0) {
                        delete this.namespaces[name];
                        ns.removeAllListeners();
                        console.log(`DB: Channel ${name} destroyed`);
                        queries.push(client.query(`UPDATE channels SET destroyed=now() WHERE id=$1::integer`, [channelID]));
                    }
                    return Promise.all(queries);
                });
                s.broadcast.emit('member-removed', member);
                console.log(`Client (${id} in ${name}) disconnected`);
                s.removeAllListeners();
            });
            s.on('get-members', (callback) => {
                this.getMembers(name).then((clients) => {
                    const result = {};
                    _.each(clients, (id) => {
                        result[id] = this.members[id].info;
                    });
                    callback({
                        me: member,
                        myID: s.id,
                        members: result,
                        count: clients.length
                    });
                });
                console.log(`Client (${id} in ${name}) requested members`);
            });
            console.log(`Client connected to namespace ${name} (${id})`);
        });
        return ns;
    }
    getMembers(name) {
        return new Promise((resolve, reject) => {
            const ns = this.io.of(`/${name}`);
            ns.clients((err, clients) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(clients);
                }
            });
        });
    }
    createTables(client) {
        const tables = this.tables;
        const queries = _.map(_.keys(tables), (tableName) => {
            const params = (tables[tableName]).join(',\n\t');
            return `CREATE TABLE IF NOT EXISTS ${tableName} (\n\t${params}\n);`;
        });
        return Promise.all(_.map(queries, (q) => client.query(q))).then(function () {
            return client;
        });
    }
    ;
    dropTables() {
        const tables = this.tables;
        const queries = _.map(_.keys(tables), (tableName) => {
            const params = (tables[tableName]).join(',\n\t');
            return `DROP TABLE IF EXISTS ${tableName} CASCADE;`;
        });
        return this.clientPromise.then((client) => {
            return Promise.all(_.map(queries, (q) => client.query(q))).then(function () {
                return client;
            });
        });
    }
    ;
    getChannelState(channelID) {
        return this.clientPromise.then((client) => {
            const queries = [
                client.query('SELECT * FROM channels WHERE id=$1::integer LIMIT 1', [channelID]),
                client.query('SELECT * FROM users WHERE channel_id=$1::integer', [channelID]),
                client.query('SELECT * FROM user_connections WHERE channel_id=$1::integer', [channelID]),
                client.query('SELECT * FROM channel_data WHERE channel_id=$1::integer', [channelID])
            ];
            return Promise.all(queries);
        }).then((result) => {
            const [channelResult, userResult, connections_result, data_result] = result;
            const channelData = channelResult.rows[0];
            const userMap = {};
            _.each(userResult.rows, (userRow) => {
                userMap[userRow.id] = {
                    row: userRow,
                    connections: []
                };
            });
            _.each(connections_result.rows, (connectionRow) => {
                const { user_id } = connectionRow;
                const u = userMap[user_id];
                if (u) {
                    u.connections.push(connectionRow);
                }
            });
            return {
                data: _.map(data_result.rows, (dataRow) => {
                    return {
                        eventName: dataRow.event_name,
                        payload: JSON.parse(dataRow.data)
                    };
                }),
                users: _.map(_.keys(userMap), (id) => {
                    const { row, connections } = userMap[id];
                    return {
                        id: row.uid,
                        name: row.name,
                        active: !_.some(connections, (c) => c['action'] === 'disconnect')
                    };
                })
            };
        });
    }
    destroy() {
        this.clientPromise.then((client) => {
            client.end();
        });
        this.io.close();
    }
}
exports.ChatCodesSocketIOServer = ChatCodesSocketIOServer;
const optionDefinitions = [
    { name: 'port', alias: 'p', type: Number, defaultOption: true, defaultValue: process.env['PORT'] || 3000 },
    { name: 'dburl', alias: 'd', type: String, defaultValue: process.env['DATABASE_URL'] || false }
];
const options = commandLineArgs(optionDefinitions);
const server = new ChatCodesSocketIOServer(options.port, options.dburl);
//# sourceMappingURL=socketio_server.js.map