require("es6-promise").polyfill();
require("@/common/libs/polyfill");
require("@/common/cfg/webim.config");
require("@/../scss/im.scss");

var utils =		require("@/common/kit/utils");
var domUtils =	require("@/common/kit/domUtils");
var Const =		require("@/common/cfg/const");
var kefuPath =	require("@/common/cfg/kefuPath");
var profile =	require("@/common/cfg/profile");
var Transfer =	require("@/common/disp/transfer");

var Dialog =	require("@/common/uikit/dialog");
var tips =		require("@/common/uikit/tips");
var apiHelper =	require("@/common/kit/apiHelper");

var chat =					require("@/app/modules/chat");
var channel =				require("@/app/modules/chat/channel");
var extendMessageSender =	require("@/app/modules/chat/extendMessageSender");

var eventCollector =		require("@/app/modules/cta/eventCollector");
var doWechatAuth =			require("@/app/modules/auth/wechat");

var body_template =			require("@/../template/body.html");

var config;
var hasChatEntryInitialized;

load_html();
if(utils.isTop){
	h5_mode_init();
}
else{
	chat_window_mode_init();
}

utils.on(window, "message", function(e){
	updateCustomerInfo(e);
});

function load_html(){
	domUtils.appendHTMLToBody(_.template(body_template)({
		contact_agent: __("common.contact_agent"),
		close: __("common.close"),
		video_ended: __("video.video_ended"),
		agent_is_typing: __("chat.agent_is_typing"),
		current_queue_number: __("chat.current_queue_number"),
		connecting: __("chat.connecting"),
		input_placeholder: __("chat.input_placeholder"),
		emoji: __("toolbar.emoji"),
		picture: __("toolbar.picture"),
		attachment: __("toolbar.attachment"),
		ticket: __("toolbar.ticket"),
		video_invite: __("toolbar.video_invite"),
		evaluate_agent: __("toolbar.evaluate_agent"),
		transfer_to_kefu: __("toolbar.transfer_to_kefu"),
		press_save_img: __("common.press_save_img"),
	}));

	chat.getDom();
}

// 直接加载 im.html 模式
function h5_mode_init(){
	config = {};
	// query：从 url 上获取参数
	config.tenantId = utils.query("tenantId");
	config.configId = utils.query("configId");
	config.offDutyType = utils.query("offDutyType");
	config.grUserId = utils.query("grUserId");

	// ajaxProxyDomain 100% 要有值
	// 这里 domain 不做添加，在 kefuPath 中检测去杂
	config.domain = utils.handleProtocol(utils.query("domain") || location.host);
	config.staticPath = "";		// 不写就是同域

	// H5 方式集成时不支持 eventCollector 配置
	config.to = utils.convertFalse(utils.query("to"));
	// h5	step 1
	// ifm	no way
	config.xmppServer = utils.convertFalse(utils.query("xmppServer"));
	config.restServer = utils.convertFalse(utils.query("restServer"));
	config.agentName = utils.convertFalse(utils.query("agentName"));
	config.resources = utils.convertFalse(utils.query("resources"));
	config.hideStatus = utils.convertFalse(utils.query("hideStatus"));
	config.satisfaction = utils.convertFalse(utils.query("sat"));
	config.wechatAuth = utils.convertFalse(utils.query("wechatAuth"));
	config.hideKeyboard = utils.convertFalse(utils.query("hideKeyboard"));

	config.appKey = utils.convertFalse(decodeURIComponent(utils.query("appKey")));
	config.offDutyWord = decodeURIComponent(utils.query("offDutyWord"));
	config.ticket = utils.query("ticket") === "" ? true : utils.convertFalse(utils.query("ticket")); // true default
	config.emgroup = decodeURIComponent(utils.query("emgroup"));

	config.user = {};
	var usernameFromUrl = utils.query("user");

	var usernameFromCookie = utils.get("root" + (config.configId || (config.tenantId + config.emgroup)));

	if(usernameFromUrl){
		config.user.username = usernameFromUrl;
	}
	else if(usernameFromCookie){
		config.user.username = usernameFromCookie;
		config.isUsernameFromCookie = true;
	}
	else{}

	profile.config = config;
	// fake transfer
	window.transfer = {
		send: function(){}
	};

	initCrossOriginIframe();
}

// iframe 加载 im.html 模式
function chat_window_mode_init(){
	var $contactAgentBtn = document.getElementById("em-widgetPopBar");
	window.transfer = new Transfer(null, "main", true).listen(function(msg){
		var event = msg.event;
		var data = msg.data;
		var extendMessage;
		var textMessage;

		switch(event){
		case Const.EVENTS.SHOW:
			// 在访客点击联系客服后停止上报访客
			if(eventCollector.isStarted()){
				eventCollector.stopReporting();
				initChatEntry();
			}

			// 访客端有进行中会话，停止了轮询，此时需要走一遍之前被跳过的初始化流程
			if(eventCollector.hasProcessingSession()){
				initChatEntry();
			}

			if(eventCollector.hasCtaInvite()){
				initChatEntry();
				eventCollector.hideCtaPrompt();
			}

			// 显示聊天窗口
			chat.show();
			break;
		case Const.EVENTS.CLOSE:
			chat.close();
			break;
		case Const.EVENTS.EXT:
			extendMessage = data.ext;
			extendMessageSender.push(extendMessage.ext);
			break;
		case Const.EVENTS.TEXTMSG:
			channel.sendText(data);
			break;
		case Const.EVENTS.UPDATE_URL:
			profile.currentBrowsingURL = data;
			break;
		case Const.EVENTS.INIT_CONFIG:
			window.transfer.to = data.parentId;
			config = data;
			profile.config = config;
			initCrossOriginIframe();
			break;
		default:
			break;
		}
	}, ["easemob"]);

	domUtils.removeClass($contactAgentBtn, "hide");
	utils.on($contactAgentBtn, "click", function(){
		transfer.send({ event: Const.EVENTS.SHOW });
	});
}

function updateCustomerInfo(e){
	var temp;
	var data = e.data;
	if(typeof data === "string"){
		data = JSON.parse(data);
	}
	temp = utils.getDataByPath(data, "easemob.kefu.cta");
	if(temp){
		var trackMsg = {
			ext: {
				// imageName: "mallImage3.png",
				// // custom代表自定义消息，无需修改
				// type: "custom",
				msgtype: {
					track: {
						// 消息标题
						title: "我正在看",
						// 商品价格
						price: "",
						// 商品描述
						desc: temp.title,
						// 商品图片链接
						img_url: "/images/robot/article_image.png",
						// 商品页面链接
						item_url: temp.item_url
					}
				}
			}
		};
		apiHelper.updateCustomerInfo({
			phone: temp.phone
		});
		channel.sendText("转人工客服", trackMsg);
	}
	temp = utils.getDataByPath(data, "easemob.kefu.iframe.scroll");
	if(temp){
		chat.setArticleIframeScrolling(temp.enable);
	}
}

function initChat(){
	apiHelper.init(config);
	apiHelper.getGrayList().then(function(grayList){
		// 灰度列表
		profile.grayList = grayList;

		// 访客回呼功能
		if(!utils.isMobile && config.eventCollector && !eventCollector.isStarted()){
			eventCollector.startToReport(function(targetUserInfo){
				initChatEntry(targetUserInfo);
			});
		}
		else{
			// 获取关联，创建访客，调用聊天窗口
			initChatEntry();
		}
	});

	apiHelper.getTheme().then(function(themeName){
		var className = Const.themeMap[themeName];
		className && domUtils.addClass(document.body, className);
	});
}

// todo: rename this function
function handleMsgData(){
	// default value
	config.offDutyWord = config.offDutyWord || __("prompt.default_off_duty_word");
	config.emgroup = config.emgroup || "";
	config.timeScheduleId = config.timeScheduleId || 0;

	if(_.isArray(config.extMsg)){
		_.each(config.extMsg, function(elem){
			extendMessageSender.push(elem);
		});
	}
	else if(_.isObject(config.extMsg)){
		extendMessageSender.push(config.extMsg);
	}

	// fake patch: 老版本配置的字符串需要decode
	if(config.offDutyWord){
		try{
			config.offDutyWord = decodeURIComponent(config.offDutyWord);
		}
		catch(e){}
	}

	if(config.emgroup){
		try{
			config.emgroup = decodeURIComponent(config.emgroup);
		}
		catch(e){}
	}

	config.user = config.user || {};
	config.visitor = config.visitor || {};

	config.channel = {};
	config.ui = {
		H5Title: {}
	};
	config.toolbar = {};
	config.chat = {};

	// 资源加载都要相对 html 路径进行加载
	profile.defaultAvatar = "static/img/default_avatar.png";

	// 用于预览模式
	if(config.previewObj){
		handleConfig(config.previewObj);
		initChat();
	}
	else if(config.configId){
		apiHelper.getConfig(config.configId).then(function(entity){
			config.tenantId = entity.tenantId;
			handleConfig(entity.configJson);
			initChat();
		});
	}
	else{
		initChat();
	}
}
function handleConfig(configJson){
	// todo: 把配置转换为新的
	// 用于config标记是否是来自于坐席端网页配置
	config.isWebChannelConfig = true;

	config.channel = configJson.channel;
	config.ui = configJson.ui;
	config.toolbar = configJson.toolbar;
	config.chat = configJson.chat;

	config.appKey = configJson.channel.appKey;
	config.to = configJson.channel.to;
	// config.agentName = configJson.channel.agentName;
	config.emgroup = configJson.channel.emgroup;

	// config.buttonText = configJson.ui.buttonText;
	// config.dialogHeight = configJson.ui.dialogHeight;
	// config.dialogWidth = configJson.ui.dialogWidth;
	// config.dialogPosition = configJson.ui.dialogPosition;
	config.dragenable = configJson.ui.dragenable;
	config.hide = configJson.ui.hide;
	config.logo = configJson.ui.logo;
	config.notice = configJson.ui.notice;
	config.themeName = configJson.ui.themeName;

	config.autoConnect = configJson.toolbar.autoConnect;
	// config.hideKeyboard = configJson.toolbar.hideKeyboard;
	config.minimum = configJson.toolbar.minimum;
	config.offDutyWord = configJson.toolbar.offDutyWord;
	config.offDutyType = configJson.toolbar.offDutyType;
	config.popupOnInitialized = configJson.toolbar.popupOnInitialized;
	config.satisfaction = configJson.toolbar.satisfaction;
	config.soundReminder = configJson.toolbar.soundReminder;
	config.ticket = configJson.toolbar.ticket;

	config.resources = configJson.chat.resources;
	config.hideStatus = configJson.chat.hideStatus;
	config.timeScheduleId = configJson.chat.timeScheduleId || 0;


	// 重新去设置iframe 的宽高
	transfer.send({
		event: Const.EVENTS.RESET_IFRAME,
		data: {
			dialogHeight: config.dialogHeight,
			dialogWidth: config.dialogWidth,
			dialogPosition: config.dialogPosition
		}
	});
}

function initCrossOriginIframe(){
	var iframe;
	kefuPath.init(config.domain);
	iframe = document.getElementById("cross-origin-iframe");
	iframe.src = kefuPath.getRes().transferHtml + "?v=" + __WEBIM_PLUGIN_VERSION__;
	utils.on(iframe, "load", function(){
		apiHelper.initApiTransfer();
		handleMsgData();
	});
}

function initChatEntry(targetUserInfo){
	if(hasChatEntryInitialized) return;
	hasChatEntryInitialized = true;
	// 获取关联信息
	apiHelper.getRelevanceList().then(function(relevanceList){
		var targetItem;
		var appKey = config.appKey;
		var splited = appKey.split("#");
		var orgName = splited[0];
		var appName = splited[1];
		var toUser = config.toUser || config.to;

		// toUser 转为字符串， todo: move it to handle config
		typeof toUser === "number" && (toUser = toUser.toString());

		if(appKey && toUser){
			// appKey，imServiceNumber 都指定了
			targetItem = _.where(relevanceList, {
				orgName: orgName,
				appName: appName,
				imServiceNumber: toUser
			})[0];
		}

		// 未指定appKey, toUser时，或未找到符合条件的关联时，默认使用关联列表中的第一项
		if(!targetItem){
			targetItem = targetItem || relevanceList[0];
			console.log("mismatched channel, use default.");
		}

		// 获取企业头像和名称
		// todo: rename to tenantName
		profile.tenantAvatar = utils.getAvatarsFullPath(targetItem.tenantAvatar, config.domain);
		profile.defaultAgentName = targetItem.tenantName;
		config.logo = config.logo || { enabled: !!targetItem.tenantLogo, url: targetItem.tenantLogo };
		config.toUser = targetItem.imServiceNumber;
		config.orgName = targetItem.orgName;
		config.appName = targetItem.appName;
		config.channelId = targetItem.channelId;

		config.appKey = config.orgName + "#" + config.appName;
		config.restServer = config.restServer || targetItem.restDomain;
		// h5	step 2
		// ifm	step 1
		config.xmppServer = config.xmppServer || targetItem.xmppServer;

		if(targetUserInfo){

			// 访客回呼模式使用后端返回的关联信息
			config.toUser = targetUserInfo.agentImName;
			config.appName = targetUserInfo.appName;
			config.orgName = targetUserInfo.orgName;
			config.appKey = targetUserInfo.orgName + "#" + targetUserInfo.appName;

			// 游客
			if(targetUserInfo.userName){
				config.user = {
					username: targetUserInfo.userName,
					password: targetUserInfo.userPassword
				};

				chat.init();
				chat.show();
				transfer.send({ event: Const.EVENTS.SHOW });
				transfer.send({
					event: Const.EVENTS.CACHEUSER,
					data: {
						username: targetUserInfo.userName,
						// todo: check if need emgroup
						group: config.user.emgroup
					}
				});
			}
			// 访客带token，sina patch
			else if(config.user.token){
				// 发送空的ext消息，延迟发送
				profile.commandMessageToBeSendList.push({ ext: { weichat: { agentUsername: targetUserInfo.agentUserName } } });
				chat.init();
				chat.show();
				transfer.send({ event: Const.EVENTS.SHOW });
			}
			else{
				apiHelper.getPassword().then(function(password){
					config.user.password = password;

					chat.init();
					chat.show();
					transfer.send({ event: Const.EVENTS.SHOW });
				}, function(err){
					console.error("username is not exist.");
					throw err;
				});
			}
			// 发送指定坐席的ext消息，延迟发送
			extendMessageSender.push({ weichat: { agentUsername: targetUserInfo.agentUserName } });
		}
		else if(config.user.username && (config.user.password || config.user.token)){
			if(config.user.token){
				// todo: move imToken to an independent key
				profile.imToken = config.user.token;
			}
			else{
				profile.imPassword = config.user.password;
			}
			chat.init();
		}
		// 检测微信网页授权
		else if(config.wechatAuth){
			doWechatAuth(function(entity){
				config.user.username = entity.userId;
				config.user.password = entity.userPassword;
				chat.init();
			}, function(){
				_downgrade();
			});
		}
		else if(config.user.username){
			apiHelper.getPassword().then(function(password){
				config.user.password = password;
				chat.init();
			}, function(){
				if(profile.grayList.autoCreateAppointedVisitor){
					_createAppointedVisitor();
				}
				else{
					_downgrade();
				}

			});
		}
		else{
			_downgrade();
		}
	}, function(err){
		if(err.statusCode === 503){
			new Dialog({
				contentDom: domUtils.createElementFromHTML([
					"<div class=\"wrapper\">",
					"<span class=\"icon-waiting\"></span>",
					"<p class=\"tip-word\">" +  __("common.session_over_limit") + "</p>",
					"</div>"
				].join("")),
				className: "session-over-limit"
			})
			.show();
		}
		else{
		// chat.show()针对移动端，在pc端不是必要的逻辑
			chat.show();
			tips.prompt(err);
			throw err;
		}
	});
}
function _createAppointedVisitor(){
	_createVisitor(config.user.username);
}
function _createVisitor(username){
	apiHelper.createVisitor(username).then(function(entity){
		var cacheKeyName = (config.configId || (config.to + config.tenantId + config.emgroup));
		config.user.username = entity.userId;
		config.user.password = entity.userPassword;

		if(entity.userPassword === ""){
			profile.imRestDown = true;
		}
		if(utils.isTop){
			utils.set("root" + (config.configId || (config.tenantId + config.emgroup)), config.user.username);
		}
		else{
			transfer.send({
				event: Const.EVENTS.CACHEUSER,
				data: {
					key: cacheKeyName,
					value: config.user.username,
				}
			});
		}
		chat.init();
	});
}
function _downgrade(){
	_createVisitor();
}
