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
  var screenShareStoppedCallback = null;

  // 초기화 함수: 시그널링 서버와의 데이터 교환 함수 및 내 연결 ID 설정
  async function init(SDP_function, my_connId, onScreenShareStoppedCallback) {
    serverProcess = SDP_function;
    myConnId = my_connId;
    screenShareStoppedCallback = onScreenShareStoppedCallback; // 💡 추가된 부분
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

  // 이벤트 처리 함수: 마이크, 비디오, 화면 공유 버튼 이벤트 설정
  function eventProcess() {
    // 마이크 음소거/해제 버튼 클릭 이벤트
    $("#micMuteUnmute").on("click", async function () {
      if (!audio) {
        await loadAudio();
      }

      if (!audio) {
        alert("오디오 장치가 없습니다.");
      }

      if (isAudioMute) {
        audio.enabled = true;
        $(this).html(
          "<span class='material-icons' style='width: 100%;'>mic</span>"
        );
        updateMediaSenders(audio, rtp_aud_senders);
      } else {
        audio.enabled = false;
        $(this).html(
          "<span class='material-icons' style='width: 100%;'>mic_off</span>"
        );
        removeMediaSenders(rtp_aud_senders);
      }
      isAudioMute = !isAudioMute;
    });

    // 카메라 켜기/끄기 버튼 클릭 이벤트
    $("#videoCamOnOff").on("click", async function () {
      if (video_st == video_states.Camera) {
        await videoProcess(video_states.None);
      } else {
        await videoProcess(video_states.Camera);
      }
    });

    // 화면 공유 켜기/끄기 버튼 클릭 이벤트
    $("#ScreenShareOnOff").on("click", async function () {
      if (video_st == video_states.ScreenShare) {
        await videoProcess(video_states.None);
      } else {
        await videoProcess(video_states.ScreenShare);
      }
    });
  }

  async function loadAudio() {
    try {
      var astream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      });
      audio = astream.getAudioTracks()[0];
      audio.enabled = false;
    } catch (e) {
      console.error("오디오 장치 로드 중 오류 발생:", e);
      return;
    }
  }

  // 연결 상태 확인 함수
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

  // 미디어 송신자 업데이트 함수: 모든 연결된 피어에게 미디어 트랙 전송
  async function updateMediaSenders(track, rtp_senders) {
    console.log("track::", track);
    console.log("rtp_senders::", rtp_senders);
    console.log("peers_connection_ids::", peers_connection_ids);
    for (var con_id in peers_connection_ids) {
      if (connection_status(peers_connection[con_id])) {
        if (rtp_senders[con_id] && rtp_senders[con_id].track) {
          rtp_senders[con_id].replaceTrack(track);
          console.log("replaceTrack::", rtp_senders[con_id]);
        } else {
          rtp_senders[con_id] =
            peers_connection[peers_connection_ids[con_id]].addTrack(track);
          console.log("addTrack::", rtp_senders[con_id]);
        }
      }
    }
  }

  // 미디어 송신자 제거 함수: 모든 연결된 피어에서 미디어 트랙 제거
  function removeMediaSenders(rtp_senders) {
    for (var con_id in peers_connection_ids) {
      if (rtp_senders[con_id] && connection_status(peers_connection[con_id])) {
        peers_connection[con_id].removeTrack(rtp_senders[con_id]);
        rtp_senders[con_id] = null;
      }
    }
  }

  // 비디오 스트림 제거 함수: 로컬 비디오 트랙 중지 및 제거
  function removeVideoStream(rtp_vid_senders) {
    if (videoCamTrack) {
      videoCamTrack.stop();
      videoCamTrack = null;
      local_div.srcObject = null;
      removeMediaSenders(rtp_vid_senders);
    }
  }

  // 비디오 처리 함수: 카메라 또는 화면 공유 상태 변경
  async function videoProcess(newVideoState) {
    if (newVideoState == video_states.None) {
      $("#videoCamOnOff").html(
        "<span class='material-icons' style='width: 100%;'>videocam_off</span>"
      );

      $("#ScreenShareOnOff").html(
        "<span class='material-icons'>present_to_all</span><div>Present Now</div>"
      );

      const wasScreenSharing = video_st === video_states.ScreenShare; // 현재 상태를 기반으로 판단해야 함

      video_st = newVideoState;
      removeVideoStream(rtp_vid_senders);

      // 화면 공유 중이었다면 콜백 실행
      if (typeof screenShareStoppedCallback === "function") {
        console.log("✅ Calling screenShareStoppedCallback()");
        screenShareStoppedCallback();
      }

      return;
    }

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
        vstream.oninactive = (e) => {
          removeVideoStream(rtp_vid_senders);
          $("#ScreenShareOnOff").html(
            "<span class='material-icons'>present_to_all</span><div>Present Now</div>"
          );
        };
      }
      video_st = newVideoState;

      if (newVideoState == video_states.Camera) {
        $("#videoCamOnOff").html(
          "<span class='material-icons' style='width: 100%;'>videocam</span>"
        );
        $("#ScreenShareOnOff").html(
          "<span class='material-icons'>present_to_all</span><div>Present Now</div>"
        );
      } else if (newVideoState == video_states.ScreenShare) {
        $("#videoCamOnOff").html(
          "<span class='material-icons' style='width: 100%;'>videocam_off</span>"
        );
        $("#ScreenShareOnOff").html(
          "<span class='material-icons text-success'>present_to_all</span><div class='text-success'>Stop Present</div>"
        );
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

  async function closeConnection(connId) {
    peers_connection_ids[connId] = null; // 연결 ID 초기화

    if (peers_connection[connId]) {
      peers_connection[connId].close(); // 연결 종료
      peers_connection[connId] = null; // 연결 객체 초기화
    }

    if (remote_aud_stream[connId]) {
      remote_aud_stream[connId].getAudioTracks().forEach((t) => {
        if (t.stop) {
          t.stop(); // 트랙 중지
        }

        remote_aud_stream[connId] = null; // 오디오 스트림 초기화
      });
    }

    if (remote_vid_stream[connId]) {
      remote_vid_stream[connId].getTracks().forEach((t) => {
        if (t.stop) {
          t.stop(); // 트랙 중지
        }
        remote_vid_stream[connId] = null; // 오디오 스트림 초기화
      });
    }
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

  async function closeShareScreen(connId) {
    if (remote_vid_stream[connId]) {
      remote_vid_stream[connId].getTracks().forEach((t) => {
        if (t.stop) {
          t.stop(); // 트랙 중지
        }

        remote_vid_stream[connId] = null; // 오디오 스트림 초기화
      });
    }
  }

  // 외부에서 사용할 함수 노출
  return {
    setNewConnection: async function (connId) {
      await setNewConnection(connId);
    },
    init: async function (SDP_function, my_connId, onScreenShareStopped) {
      await init(SDP_function, my_connId, onScreenShareStopped);
    },
    processClientFunc: async function (data, from_connId) {
      await SDPProcess(data, from_connId);
    },
    closeConnectionCall: async function (connId) {
      await closeConnection(connId);
    },
    closeShareScreen: async function (connId) {
      await closeShareScreen(connId);
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
    eventHandeling(); // 이벤트 핸들링 설정
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
        app.init(SDP_function, socket.id, onScreenShareStopped);

        if (user_id != "" && meeting_id != "") {
          // 사용자 접속 정보 서버에 알림
          socket.emit("userconnect", {
            displayName: user_id,
            meetingid: meeting_id,
          });
        }
      }
    });

    // 소켓 연결 해제 시
    socket.on("inform_other_about_disconnected_user", function (data) {
      console.log("inform_other_about_disconnected_user::", data);
      $("#" + data.connId).remove(); // UI에서 사용자 제거
      $(".participant-count").text(data.uNumber);
      $("#participant_" + data.connId + "").remove(); // 사용자 목록에서 제거
      app.closeConnectionCall(data.connId);
    });

    // 다른 유저가 접속했을 때
    socket.on("inform_others_about_me", (data) => {
      // UI에 사용자 추가
      addUser(data.other_user_id, data.connId, data.userNumber);
      // WebRTC 연결 생성
      app.setNewConnection(data.connId);
    });

    // 다른 유저가 접속했음을 알림 받았을 때
    socket.on("inform_me_about_other_user", (other_users) => {
      var userNumber = other_users.length; // 현재 접속한 사용자 수
      var userNumb = userNumber + 1; // 나 포함

      if (other_users) {
        other_users.forEach(function (other) {
          // UI에 사용자 추가
          addUser(other.user_id, other.connectionId, userNumb);
          // WebRTC 연결 생성
          app.setNewConnection(other.connectionId);
        });
      }
    });

    //화면 공유 제가 알림 받았을 때
    socket.on("infrom_other_share_closed", function (data) {
      console.log("infrom_other_share_closed::", data);
      app.closeShareScreen(data.connId); // 화면 공유 종료
    });

    // 시그널링 메시지 수신 시 처리
    socket.on("SDPProcess", async function (data) {
      await app.processClientFunc(data.message, data.from_connId);
    });

    socket.on("showChatMessage", function (data) {
      console.log("showChatMessage", data);
      // 채팅 메시지 수신 시 처리
      var time = new Date();
      var lTime = time.toLocaleTimeString("ko-KR", {
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      });
      var div = $("<div>").html(
        "<span class='font-weight-bold mr-3' style='color:black'>" +
          data.from +
          "</span><span class='text-muted'>" +
          lTime +
          "</span><br>" +
          data.message
      );
      $("#messages").append(div); // 메시지 UI에 추가
    });
  }

  // 이벤트 핸들링 설정
  function eventHandeling() {
    // 회의 종료 버튼 클릭 시
    $("#btnsend").on("click", function () {
      var msg = $("#msgbox").val();
      socket.emit("sendMessage", msg); // 메시지 전송
      // 채팅 메시지 수신 시 처리
      var time = new Date();
      var lTime = time.toLocaleTimeString("ko-KR", {
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      });
      var div = $("<div>").html(
        "<span class='font-weight-bold mr-3' style='color:black'>" +
          user_id +
          "</span><span class='text-muted'>" +
          lTime +
          "</span><br>" +
          msg
      );
      $("#messages").append(div); // 메시지 UI에 추가
      $("#msgbox").val("");
    });
  }

  // 새로운 유저 UI 추가 함수
  function addUser(other_user_id, connId, userNum) {
    var newDivId = $("#otherTemplate").clone(); // 템플릿 복사
    newDivId = newDivId.attr("id", connId).addClass("other");
    newDivId.find("h2").text(other_user_id); // 이름 표시
    newDivId.find("video").attr("id", "v_" + connId); // 비디오 ID 지정
    newDivId.find("audio").attr("id", "a_" + connId); // 오디오 ID 지정
    newDivId.show(); // 화면에 표시
    $("#divUsers").append(newDivId); // UI에 추가

    $(".in-call-wrap-up").append(
      ' <div class="in-call-wrap d-flex justify-content-between align-items-center mb-3" id="participant_' +
        connId +
        '"> <div class="participant-img-name-wrap display-center cursor-pointer"> <div class="participant-img"> <img src="public/Assets/images/other.jpg" alt="" class="border border-secondary" style="height: 40px; width: 40px; border-radius: 50%;"> </div> <div class="participant-name ml-2">' +
        other_user_id +
        '</div> </div> <div class="participant-action-wrap display-center"> <div class="participant-action-dot display-center mr-2 cursor-pointer"> <span class="material-icons">more_vert</span> </div> <div class="participant-action-pin display-center mr-2 cursor-pointer"> <span class="material-icons">push_pin</span> </div> </div> </div>'
    ); // 사용자 목록에 추가

    $(".participant-count").text(userNum); // 사용자 수 업데이트
  }

  function onScreenShareStopped() {
    console.log("screen_share_stopped emit 시도 중...");
    socket.emit("screen_share_stopped", {
      from: user_id,
      meetingid: meeting_id,
    });
  }

  $(document).on("click", ".people-heading", function () {
    $(".in-call-wrap-up").show(300);
    $(".chat-show-wrap").hide(300);
    $(this).addClass("active");
    $(".chat-heading").removeClass("active");
  });

  $(document).on("click", ".chat-heading", function () {
    $(".in-call-wrap-up").hide(300);
    $(".chat-show-wrap").show(300);
    $(this).addClass("active");
    $(".people-heading").removeClass("active");
  });

  $(document).on("click", ".meeting-heading-cross", function () {
    $(".g-right-details-wrap").hide(300);
  });

  $(document).on("click", ".top-left-participant-wrap", function () {
    $(".g-right-details-wrap").show(300);
    $(".in-call-wrap-up").show(300);
    $(".chat-show-wrap").hide(300);
  });

  $(document).on("click", ".top-left-chat-wrap", function () {
    $(".g-right-details-wrap").show(300);
    $(".in-call-wrap-up").hide(300);
    $(".chat-show-wrap").show(300);
  });

  $(document).on("click", ".end-call-wrap", function () {
    $(".top-box-show")
      .css({ display: "block" })
      .html(
        '<div class="top-box align-vertical-middle profile-dialogue-show">' +
          '<h4 class="mt-3" style="text-align:center; color:white;">Leave Meeting</h4> <hr>' +
          '<div class="call-leave-cancel-action d-flex justify-content-center align-items-center w-100">' +
          '<a href="/action.html"> <button class="call-leave-action btn btn-danger mr-5">Leave</button> </a> <button class="call-cancel-action btn btn-secondary">Cancel</button> </div> </div>'
      );
  });

  $(document).mouseup(function (e) {
    var container = new Array();
    container.push($(".top-box-show"));
    $.each(container, function (key, value) {
      if (!$(value).is(e.target) && $(value).has(e.target).length === 0) {
        $(value).empty();
      }
    });
  });

  $(document).on("click", ".call-cancel-action", function () {
    $(".top-box-show").html("");
  });

  // 외부 접근 가능 함수
  return {
    _init: function (uid, mid) {
      init(uid, mid); // 초기화 실행
    },
  };
})();
