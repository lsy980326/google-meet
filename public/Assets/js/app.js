// WebRTC 연결을 위한 AppProcess 모듈 정의
var AppProcess = function () {
  // 연결된 피어의 고유 ID 목록
  var peers_connection_ids = [];

  // 피어당 RTCPeerConnection 객체 저장
  var peers_connection = [];

  // 피어당 비디오 스트림 저장
  var remote_vid_stream = [];

  // 피어당 오디오 스트림 저장
  var remote_aud_stream = [];

  // SDP (세션 기술 프로토콜) 교환 함수와 본인의 연결 ID
  var serverProcess;
  var myConnId;
  var local_div; // 로컬 비디오 플레이어 DOM 요소
  var audio; // 오디오 장치 객체
  var isAudioMute = true; // 오디오 음소거 상태 변수
  var rtp_aud_senders = []; // 오디오 RTP 송신자 목록
  var video_states = {
    None: 0,
    Camera: 1,
    ScreenShare: 2,
  };
  var video_st = video_states.None; // 비디오 상태 변수
  var videoCamTrack; // 비디오 카메라 트랙 객체
  var rtp_vid_senders = []; // 비디오 RTP 송신자 목록

  // 초기화 함수: 시그널링 서버와의 데이터 교환 함수 및 내 연결 ID 설정
  async function init(SDP_function, my_connId) {
    serverProcess = SDP_function;
    myConnId = my_connId;
    eventProcess();
    local_div = document.getElementById("localVideoPlayer"); // 로컬 비디오 플레이어 초기화
  }

  // WebRTC용 STUN 서버 설정 (공용 구글 서버 사용)
  var iceConfiguaration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  function eventProcess() {
    $("#micMuteUnmute").on("click", async function () {
      if (!audio) {
        await loadAudio();
      }

      if (!audio) {
        alert("오디오 장치가 없습니다.");
      }

      if (isAudioMute) {
        audio.enabled = true;
        $(this).html("<span class='material-icons'>mic</span>");
        updateMediaSenders(audio, rtp_aud_senders);
      } else {
        audio.enabled = false;
        $(this).html("<span class='material-icons'>mic_off</span>");
        removeMediaSenders(rtp_aud_senders);
      }
      isAudioMute = !isAudioMute;
    });
    $("#videoCamOnOff").on("click", async function () {
      if (video_st == video_states.Camera) {
        await videoProcess(video_states.None);
      } else {
        await videoProcess(video_states.Camera);
      }
    });
  }

  function connection_status(connection) {
    console.log("connection_status:::", connection.connectionState);
    if (
      (connection && connection.connectionState == "new") ||
      connection.connectionState == "connecting" ||
      connection.connectionState == "connected"
    ) {
      return true;
    } else {
      return false;
    }
  }

  async function updateMediaSenders(track, rtp_senders) {
    console.log("track::", track);
    console.log("rtp_senders::", rtp_senders);
    console.log("peers_connection_ids::", peers_connection_ids);
    for (var con_id in peers_connection_ids) {
      if (connection_status(peers_connection[con_id])) {
        if (rtp_senders[con_id] && rtp_senders[con_id].track) {
          rtp_senders[con_id].replaceTrack(track);
        } else {
          rtp_senders[con_id] =
            peers_connection[peers_connection_ids[con_id]].addTrack(track);
        }
      }
    }
  }

  async function videoProcess(newVideoState) {
    try {
      var vstream = null;
      if (newVideoState == video_states.Camera) {
        vstream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 1920,
            height: 1080,
          },
          audio: false,
        });
      } else if (newVideoState == video_states.ScreenShare) {
        vstream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: 1920,
            height: 1080,
          },
          audio: false,
        });
      }
      if (vstream && vstream.getVideoTracks().length > 0) {
        videoCamTrack = vstream.getVideoTracks()[0];
        if (videoCamTrack) {
          console.log("비디오 장치 연결됨:", videoCamTrack.label);
          local_div.srcObject = new MediaStream([videoCamTrack]);
          updateMediaSenders(videoCamTrack, rtp_vid_senders);
          // alert("비디오 장치가 연결되었습니다.");
        }
      }
    } catch (e) {
      console.error("미디어 스트림을 가져오는 중 오류 발생:", e);
      return;
    }
    video_st = newVideoState;
  }

  // 새로운 피어와의 연결을 위한 RTCPeerConnection 객체 생성
  async function setNewConnection(connId) {
    var connection = new RTCPeerConnection(iceConfiguaration);

    // offer 생성이 필요한 경우 자동으로 호출됨
    connection.onnegotiationneeded = async function (event) {
      await setOffer(connId);
    };

    // ICE 후보(네트워크 정보)가 생성되었을 때 호출됨
    connection.onicecandidate = function (event) {
      if (event.candidate) {
        // 시그널링 서버를 통해 상대 피어에게 ICE 후보 전송
        serverProcess(
          JSON.stringify({ icecandidate: event.candidate }),
          connId
        );
      }
    };

    // 원격 미디어 트랙 수신 시 호출됨
    connection.ontrack = function (event) {
      // 연결 ID별로 비디오/오디오 스트림 저장소 초기화
      if (!remote_vid_stream[connId]) {
        remote_vid_stream[connId] = new MediaStream();
      }
      if (!remote_aud_stream[connId]) {
        remote_aud_stream[connId] = new MediaStream();
      }

      // 비디오 트랙 처리
      if (event.track.kind == "video") {
        // 기존 비디오 트랙 제거 후 새 트랙 추가
        remote_vid_stream[connId]
          .getVideoTracks()
          .forEach((t) => remote_vid_stream[connId].removeTrack(t));
        remote_vid_stream[connId].addTrack(event.track);

        // 비디오 플레이어에 스트림 적용
        var remoteVideoPlayer = document.getElementById("v_" + connId);
        remoteVideoPlayer.srcObject = null;
        remoteVideoPlayer.srcObject = remote_vid_stream[connId];
        remoteVideoPlayer.load();

        // 오디오 트랙 처리
      } else if (event.track.kind == "audio") {
        remote_aud_stream[connId]
          .getAudioTracks()
          .forEach((t) => remote_aud_stream[connId].removeTrack(t));
        remote_aud_stream[connId].addTrack(event.track);

        var remoteAudioPlayer = document.getElementById("a_" + connId);
        remoteAudioPlayer.srcObject = null;
        remoteAudioPlayer.srcObject = remote_aud_stream[connId];
        remoteAudioPlayer.load();
      }
    };

    // 연결 정보 저장
    peers_connection_ids[connId] = connId;
    peers_connection[connId] = connection;

    if (
      video_st == video_states.Camera ||
      video_st == video_states.ScreenShare
    ) {
      if (videoCamTrack) {
        // 카메라 또는 화면 공유 비디오 트랙을 연결에 추가
        updateMediaSenders(videoCamTrack, rtp_vid_senders);
      }
    }

    return connection;
  }

  // offer 생성 및 전송 함수
  async function setOffer(connId) {
    var connection = peers_connection[connId];
    var offer = await connection.createOffer(); // offer SDP 생성
    await connection.setLocalDescription(offer); // 로컬 SDP 설정

    // 시그널링 서버에 offer 전송
    serverProcess(
      JSON.stringify({ offer: connection.localDescription }),
      connId
    );
  }

  // SDP 메시지를 처리하는 함수 (offer 또는 answer 수신 처리)
  async function SDPProcess(message, from_connId) {
    message = JSON.parse(message);

    if (message.answer) {
      // 상대 피어의 answer를 받아서 remoteDescription에 설정
      await peers_connection[from_connId].setRemoteDescription(
        new RTCSessionDescription(message.answer)
      );
    } else if (message.offer) {
      // 상대 피어의 offer를 받은 경우
      if (!peers_connection[from_connId]) {
        // 연결이 없으면 새로 생성
        await setNewConnection(from_connId);
      }

      var connection = peers_connection[from_connId];
      await connection.setRemoteDescription(
        new RTCSessionDescription(message.offer)
      );

      // answer 생성 및 전송
      var answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      serverProcess(JSON.stringify({ answer: answer }), from_connId);
    } else if (message.icecandidate) {
      if (!peers_connection[from_connId]) {
        // 연결이 없으면 새로 생성
        await setNewConnection(from_connId);
      }
      try {
        await peers_connection[from_connId].addIceCandidate(
          message.icecandidate
        );
      } catch (e) {
        console.log("Error in ICE candidate: ", e);
      }
    }
  }

  // 외부에서 사용할 함수 노출
  return {
    setNewConnection: async function (connId) {
      await setNewConnection(connId);
    },
    init: async function (SDP_function, my_connId) {
      await init(SDP_function, my_connId);
    },
    processClientFunc: async function (data, from_connId) {
      await SDPProcess(data, from_connId);
    },
  };
};

const app = AppProcess(); // 전역 혹은 모듈 스코프에서 선언

// MyApp 모듈: 전체 WebRTC 흐름을 담당
var MyApp = (function () {
  var socket = null; // socket.io 소켓
  var user_id = ""; // 사용자 ID
  var meeting_id = ""; // 회의방 ID

  // 초기화 함수: 사용자/회의 ID 저장 및 소켓 통신 초기화
  function init(uid, mid) {
    user_id = uid;
    meeting_id = mid;
    $("#meetingContainer").show(); // 회의 UI 표시
    $("#me h2").text(user_id + "(Me)"); // 사용자 이름 표시
    document.title = user_id + " - WebRTC"; // 브라우저 제목 설정
    event_process_for_signaling_server(); // 시그널링 서버 연결 처리
  }

  // 시그널링 서버와의 이벤트 통신 처리 함수
  function event_process_for_signaling_server() {
    socket = io.connect(); // 소켓 서버에 연결

    // 서버로 데이터 전송 시 사용할 함수 정의
    var SDP_function = function (data, to_connId) {
      socket.emit("SDPProcess", {
        message: data,
        to_connId: to_connId,
      });
    };

    // 소켓 연결 완료 시
    socket.on("connect", () => {
      if (socket.connected) {
        // AppProcess 모듈 초기화
        app.init(SDP_function, socket.id);

        if (user_id != "" && meeting_id != "") {
          // 사용자 접속 정보 서버에 알림
          socket.emit("userconnect", {
            displayName: user_id,
            meetingid: meeting_id,
          });
        }
      }
    });

    // 다른 유저가 접속했음을 알림 받았을 때
    socket.on("inform_others_about_me", (data) => {
      // UI에 사용자 추가
      addUser(data.other_user_id, data.connId);
      // WebRTC 연결 생성
      app.setNewConnection(data.connId);
    });

    // 다른 유저가 접속했음을 알림 받았을 때
    socket.on("inform_me_about_other_user", (other_users) => {
      if (other_users) {
        other_users.forEach(function (other) {
          // UI에 사용자 추가
          addUser(other.user_id, other.connectionId);
          // WebRTC 연결 생성
          app.setNewConnection(other.connectionId);
        });
      }
    });

    // 시그널링 메시지 수신 시 처리
    socket.on("SDPProcess", async function (data) {
      await app.processClientFunc(data.message, data.from_connId);
    });
  }

  // 새로운 유저 UI 추가 함수
  function addUser(other_user_id, connId) {
    var newDivId = $("#otherTemplate").clone(); // 템플릿 복사
    newDivId = newDivId.attr("id", connId).addClass("other");
    newDivId.find("h2").text(other_user_id); // 이름 표시
    newDivId.find("video").attr("id", "v_" + connId); // 비디오 ID 지정
    newDivId.find("audio").attr("id", "a_" + connId); // 오디오 ID 지정
    newDivId.show(); // 화면에 표시
    $("#divUsers").append(newDivId); // UI에 추가
  }

  // 외부 접근 가능 함수
  return {
    _init: function (uid, mid) {
      init(uid, mid); // 초기화 실행
    },
  };
})();
