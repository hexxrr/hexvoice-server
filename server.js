const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const MAX_USERS_PER_ROOM = 6;

const rooms = new Map();

const server = new WebSocket.Server({
    port: PORT
});

console.log(`BADsquad server running on port ${PORT}`);

function sendJson(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function getRoomMembers(room) {
    return Array.from(room).map((member) => ({
        id: member.userId,
        name: member.userName
    }));
}

function broadcastRoomMembers(room) {
    const members = getRoomMembers(room);

    for (const member of room) {
        sendJson(member, {
            type: "room_members",
            members: members
        });
    }
}

function sendJoinNotification(room, joinedUser) {
    const joinedName =
        joinedUser.userName || "Unknown";

    for (const member of room) {
        if (member === joinedUser) {
            continue;
        }

        sendJson(member, {
            type: "join_notification",
            name: joinedName,
            title: "BADsquad",
            message:
                `${joinedName} has joined BADsquad`
        });
    }
}

/*
 * Audio packet format:
 *
 * [0x7F]
 * [senderIdLength]
 * [senderId UTF-8]
 * [PCM16 LE audio]
 *
 * Isse receiver ko pata chalega
 * ki voice kis member ki hai.
 */
function makeAudioPacket(senderId, pcmData) {
    const id = Buffer.from(
        senderId || "",
        "utf8"
    );

    const idLength = Math.min(
        id.length,
        255
    );

    const header = Buffer.alloc(
        2 + idLength
    );

    header[0] = 0x7F;
    header[1] = idLength;

    id.copy(
        header,
        2,
        0,
        idLength
    );

    return Buffer.concat([
        header,
        pcmData
    ]);
}

function leaveRoom(ws) {
    const roomId = ws.roomId;

    if (!roomId) {
        return;
    }

    const room = rooms.get(roomId);

    if (!room) {
        ws.roomId = null;
        return;
    }

    room.delete(ws);

    for (const member of room) {
        sendJson(member, {
            type: "user_left",
            name: ws.userName || "Unknown"
        });
    }

    broadcastRoomMembers(room);

    if (room.size === 0) {
        rooms.delete(roomId);
    }

    ws.roomId = null;
    ws.userId = null;
    ws.userName = null;
}

server.on("connection", (ws) => {

    ws.roomId = null;
    ws.userId = null;
    ws.userName = null;

    sendJson(ws, {
        type: "connected",
        message:
            "BADsquad server connected"
    });

    ws.on("message", (data, isBinary) => {

        /*
         * TEXT / JSON MESSAGE
         */
        if (!isBinary) {

            try {

                const message =
                    JSON.parse(
                        data.toString()
                    );

                /*
                 * JOIN ROOM
                 */
                if (message.type === "join") {

                    const roomId =
                        String(
                            message.room || ""
                        )
                            .trim()
                            .toUpperCase();

                    const userName =
                        String(
                            message.name || ""
                        )
                            .trim()
                            .substring(
                                0,
                                20
                            );

                    if (!roomId) {

                        sendJson(ws, {
                            type: "error",
                            message:
                                "Room code missing"
                        });

                        return;
                    }

                    if (!userName) {

                        sendJson(ws, {
                            type: "error",
                            message:
                                "Name missing"
                        });

                        return;
                    }

                    /*
                     * Agar already kisi room mein hai
                     * to pehle leave karwao.
                     */
                    if (ws.roomId) {
                        leaveRoom(ws);
                    }

                    let room =
                        rooms.get(roomId);

                    if (!room) {

                        room = new Set();

                        rooms.set(
                            roomId,
                            room
                        );
                    }

                    /*
                     * MAX 6 USERS
                     */
                    if (
                        room.size >=
                        MAX_USERS_PER_ROOM
                    ) {

                        sendJson(ws, {
                            type:
                                "room_full",
                            message:
                                "Room is full. Maximum 6 users."
                        });

                        return;
                    }

                    /*
                     * USER ID
                     */
                    ws.roomId = roomId;

                    ws.userId =
                        Math.random()
                            .toString(36)
                            .substring(
                                2,
                                10
                            );

                    ws.userName =
                        userName;

                    room.add(ws);

                    /*
                     * JOINED RESPONSE
                     */
                    sendJson(ws, {

                        type: "joined",

                        room: roomId,

                        name: userName,

                        users:
                            room.size,

                        maxUsers:
                            MAX_USERS_PER_ROOM
                    });

                    /*
                     * Notify existing users
                     */
                    for (
                        const member of room
                    ) {

                        if (
                            member === ws
                        ) {
                            continue;
                        }

                        sendJson(member, {

                            type:
                                "user_joined",

                            name:
                                userName,

                            users:
                                room.size,

                            maxUsers:
                                MAX_USERS_PER_ROOM
                        });
                    }

                    /*
                     * Join notification
                     */
                    sendJoinNotification(
                        room,
                        ws
                    );

                    /*
                     * Updated member list
                     */
                    broadcastRoomMembers(
                        room
                    );

                    return;
                }

                /*
                 * LEAVE ROOM
                 */
                if (
                    message.type ===
                    "leave"
                ) {

                    leaveRoom(ws);

                    return;
                }

                /*
                 * MIC STATUS
                 */
                if (
                    message.type ===
                    "mic_status"
                ) {

                    if (!ws.roomId) {
                        return;
                    }

                    const room =
                        rooms.get(
                            ws.roomId
                        );

                    if (!room) {
                        return;
                    }

                    const muted =
                        Boolean(
                            message.muted
                        );

                    for (
                        const member of room
                    ) {

                        sendJson(member, {

                            type:
                                "mic_status",

                            id:
                                ws.userId,

                            name:
                                ws.userName,

                            muted:
                                muted
                        });
                    }

                    return;
                }

            } catch (error) {

                console.error(
                    "JSON error:",
                    error
                );

                sendJson(ws, {

                    type: "error",

                    message:
                        "Invalid message"
                });
            }

            return;
        }

        /*
         * BINARY AUDIO DATA
         */
        if (!ws.roomId) {
            return;
        }

        const room =
            rooms.get(
                ws.roomId
            );

        if (!room) {
            return;
        }

        /*
         * Audio ko sender ID ke saath
         * wrap karo.
         */
        const audioPacket =
            makeAudioPacket(
                ws.userId,
                data
            );

        /*
         * Room ke baaki sab users ko
         * audio bhejo.
         */
        for (
            const member of room
        ) {

            if (
                member !== ws &&
                member.readyState ===
                    WebSocket.OPEN
            ) {

                member.send(
                    audioPacket,
                    {
                        binary: true
                    }
                );
            }
        }
    });

    /*
     * CONNECTION CLOSED
     */
    ws.on("close", () => {

        leaveRoom(ws);

    });

    /*
     * CONNECTION ERROR
     */
    ws.on("error", (error) => {

        console.error(
            "WebSocket error:",
            error
        );

        leaveRoom(ws);

    });
});

/*
 * Render shutdown handling
 */
process.on("SIGTERM", () => {

    for (
        const room of rooms.values()
    ) {

        for (
            const ws of room
        ) {

            try {

                ws.close();

            } catch (_) {
            }
        }
    }

    rooms.clear();

    server.close(() => {

        process.exit(0);

    });
});
