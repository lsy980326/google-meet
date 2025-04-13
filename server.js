// Express와 path 모듈 불러오기
const express = require("express"); // 웹 서버 생성을 위한 Express 프레임워크
const path = require("path"); // 경로 조작을 위한 Node.js 내장 모듈

// Express 앱 객체 생성
var app = express();

// 웹 서버 실행: 3000번 포트에서 리스닝 시작
var server = app.listen(3000, function () {
  console.log("listening to requests on port 3000");
});

// Socket.IO 서버 생성 및 기존 HTTP 서버에 연결
// allowEIO3: 오래된 클라이언트(EIOv3, 예: 구형 브라우저나 클라이언트 앱)와 호환성 유지
const io = require("socket.io")(server, {
  allowEIO3: true,
});

// 현재 서버 디렉토리를 정적 파일 경로로 설정
// 예: HTML, JS, CSS 파일이 있는 폴더를 웹에서 접근 가능하게 만듦
app.use(express.static(path.join(__dirname, "")));

// 모든 클라이언트의 연결 정보를 저장하는 배열
// 구조: [{ connectionId: 소켓 ID, user_id: 사용자 이름, meeting_id: 회의 ID }]
var userConnections = [];

// 클라이언트가 소켓에 처음 연결되었을 때 실행되는 이벤트
io.on("connection", (socket) => {
  console.log("socket id is ", socket.id); // 현재 연결된 소켓의 고유 ID 출력

  // 'userconnect' 이벤트를 수신하면 해당 사용자의 정보 처리 시작
  socket.on("userconnect", (data) => {
    console.log("userconnect", data.displayName, data.meetingid);

    // 현재 접속한 사용자가 속한 회의(meeting_id)와 같은 회의에 접속 중인 사용자 목록 필터링
    var other_users = userConnections.filter(
      (p) => p.meeting_id == data.meetingid
    );

    // 현재 접속한 사용자의 정보 저장
    userConnections.push({
      connectionId: socket.id, // 현재 소켓의 고유 ID
      user_id: data.displayName, // 사용자 이름
      meeting_id: data.meetingid, // 회의방 ID
    });

    // 같은 회의방에 있는 다른 사용자들에게 현재 접속한 사용자의 정보를 알림
    other_users.forEach((v) => {
      // 개별 사용자에게 알림 전송 (broadcast는 아님)
      socket.to(v.connectionId).emit("inform_others_about_me", {
        other_user_id: data.displayName, // 접속한 사용자 이름
        connId: socket.id, // 접속한 사용자의 소켓 ID
      });
    });

    socket.emit("inform_me_about_other_user", other_users);
  });

  // 'SDPProcess' 이벤트 수신: WebRTC용 SDP, ICE 메시지 전달 처리
  socket.on("SDPProcess", (data) => {
    // 상대 피어(지정된 연결 ID)에 시그널링 메시지 전달
    socket.to(data.to_connId).emit("SDPProcess", {
      message: data.message, // offer / answer / candidate 정보
      from_connId: socket.id, // 보낸 사람의 소켓 ID
    });
  });

  socket.on("sendMessage", (msg) => {
    console.log("sendMessage", msg);
    var mUser = userConnections.find((p) => p.connectionId == socket.id); // 현재 소켓 ID에 해당하는 사용자 정보 찾기
    if (mUser) {
      console.log(mUser);
      var meetingid = mUser.meeting_id; // 회의 ID 저장
      var from = mUser.user_id; // 사용자 이름 저장
      var list = userConnections.filter((p) => p.meeting_id == meetingid); // 같은 회의 ID를 가진 사용자 목록 필터링
      list.forEach((v) => {
        // 각 사용자에게 메시지 전송
        socket.to(v.connectionId).emit("showChatMessage", {
          from: from, // 메시지를 보낸 사용자 이름
          message: msg, // 메시지 내용
          connId: socket.id, // 보낸 사람의 소켓 ID
        });
      });
    }
  });

  socket.on("disconnect", function () {
    console.log("user disconnected", socket.id); // 소켓 연결 해제 시 메시지 출력

    var disuser = userConnections.find((p) => p.connectionId == socket.id); // 연결 해제된 소켓 ID 찾기
    if (disuser) {
      var meeting_id = disuser.meeting_id; // 회의 ID 저장
      userConnections.filter((p) => p.connectionId != socket.id); // 연결 해제된 소켓 ID 제거

      var list = userConnections.filter((p) => p.meeting_id == meeting_id); // 같은 회의 ID를 가진 사용자 목록 필터링
      list.forEach((v) => {
        // 각 사용자에게 연결 해제된 사용자 정보를 알림
        socket.to(v.connectionId).emit("inform_other_about_disconnected_user", {
          disuser_id: disuser.user_id, // 연결 해제된 사용자 이름
          connId: socket.id, // 연결 해제된 소켓 ID
        });
      });
    }
  });

  socket.on("screen_share_stopped", (data) => {
    userConnections
      .filter((u) => u.meeting_id === data.meetingid && u.user_id !== data.from)
      .forEach((u) => {
        const sender = userConnections.find(
          (p) => p.meeting_id === data.meetingid && p.user_id === data.from
        );

        if (sender) {
          socket.to(u.connectionId).emit("infrom_other_share_closed", {
            from: data.from,
            connId: sender.connectionId,
          });
        }
      });
  });
});
