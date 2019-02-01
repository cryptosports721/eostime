import {Confetti, GUIManager} from "./GUIManager";
import {ViewStateObserver} from "./ViewStateObserver";
import {SocketMessage} from "../server/SocketMessage";
import {Moment} from "moment";
import {Config} from "./Config";
import { Api, JsonRpc } from 'eosjs';
import {HarpoonAnimation} from "./HarpoonAnimation";

var moment = require('moment');

declare var CAPTCHA_LOADED;
declare var grecaptcha;
declare var onCaptchaData;
declare var onCaptchaDataExpired;
declare var Odometer;

export class AuctionManager extends ViewStateObserver {

    private eos:any = null;
    private guiManager:GUIManager = null;
    private socketMessage:SocketMessage = null;
    private auctionElements:JQuery<HTMLElement>[] = null;
    private confetti:Confetti = null;
    private referrer:string = null;
    private currentLanguage:string = null;
    private clientSeed:number;
    private autoRandomize:boolean = true;
    private eosNetwork:string = "mainnet";
    private secsPerOdometerUpdate:number = 2;
    private secsSinceOdometerUpdate:number = 0;

    private selectors:any = {
        "mainAuctionArea": ".main-auction-area",
        "auctionInstancesLoading": ".auction-instances-loading",
        "auctionInstancesContainer": ".auction-instances-container",
        "auctionTemplate": ".auction-instance-template",
        "auctionInstance": ".auction-instance",
        "auctionInstanceBidderOuter": ".auction-instance-bidder",
        "auctionInstanceBidder": ".auction-instance-bidder-account-name",
        "auctionInstanceBloksLink": ".auction-instance-bidder-bloks-link",
        "auctionInstanceNoBidder": ".auction-instance-bidder-no-bidders",
        "auctionInstancePrizePool": ".auction-instance-prize-pool span:nth-child(2)",
        "auctionInstanceRemainingBids": ".auction-instance-remaining-bids > span",
        "auctionInstanceBidAmount": ".auction-instance-bid-amount",
        "auctionInstanceRemainingTime": ".auction-instance-remaining-time",
        "auctionInstanceDays": ".auction-instance-days",
        "auctionInstanceHours": ".auction-instance-hours",
        "auctionInstanceMinutes": ".auction-instance-minutes",
        "auctionInstanceSeconds": ".auction-instance-seconds",
        "daysContainer": ".days-container",
        "formattedTimerString": ".formatted-timer-string",
        "auctionInstanceBidButton": ".auction-instance-bid-button",
        "auctionInstanceLoginButton": ".auction-instance-login-button",
        "animatedFlash": ".animated-flash",
        "auctionInstanceInnerContainer": ".auction-instance-inner-container",
        "auctionInstanceEnded": ".auction-instance-ended",
        "auctionInstanceId": ".auction-instance-id",
        "auctionInstanceBusy": ".auction-instance-busy",
        "auctionWinners": ".auction-winners",
        "auctionWinnersInner": ".auction-winners-inner",
        "auctionWinnerShowDetail": ".auction-winners-show-details",
        "auctionWinnerInstanceTemplate": ".auction-winner-instance-template",
        "auctionWinnerWhale": ".auction-winner-whale",
        "auctionWinnerInstanceTime": ".auction-winner-time",
        "auctionWinnerInstanceName": ".auction-winner-name",
        "auctionWinnerInstanceId": ".auction-winner-id",
        "auctionWinnerInstanceIdLink": ".auction-winner-id-link",
        "auctionWinnerInstanceDuration": ".auction-winner-duration",
        "auctionWinnerInstanceAmount": ".auction-winner-amount span:nth-child(2)",
        "ribbonContainer": ".ribbon-container",
        "auctionClientSeed": ".auction-instance-client-seed",
        "auctionServerHash" : ".auction-instance-server-hash",
        "auctionBombButton" : ".auction-instance-bomb-button",
        "auctionBombOdds" : ".auction-instance-bomb-odds",
        "auctionInstanceHarpoonOverlay": ".auction-instance-harpoon-overlay",
        "auctionWinnersHarpoon": ".auction-winner-harpoon",
        "auctionInstanceTimeTokenOdometer": ".auction-instance-tt-odometer",
        "auctionInstanceBonusTimeContainer": ".auction-instance-bonus-time-container"
    };

    /**
     * Constructs our Auction game manager
     */
    constructor(socketMessage:SocketMessage, guiManager:GUIManager) {
        super();
        this.socketMessage = socketMessage;
        this.guiManager = guiManager;

        // Interval to update our auction instances
        let localThis:AuctionManager = this;
        window.setInterval(() => {
            $(this.selectors.auctionInstance).each(function(i) {
                let $elem:any = $(this);
                localThis.updateRemainingTime(<JQuery<HTMLElement>>$elem);
            });

            localThis.secsSinceOdometerUpdate--;
            if (localThis.secsSinceOdometerUpdate <= 0) {
                localThis.secsSinceOdometerUpdate  = localThis.secsPerOdometerUpdate;
                $(this.selectors.auctionInstance).each(function (i) {
                    let $elem:any = $(this);
                    localThis.updateBonusTimeTokens(<JQuery<HTMLElement>>$elem, Math.floor(new Date().getTime()/1000));
                });
            }
        }, 1000);

        // Deal with clientSeed
        let clientSeed: string = localStorage.getItem(Config.LOCAL_STORAGE_KEY_CLIENT_SEED);
        if (clientSeed !== null) {
            this.clientSeed = parseInt(clientSeed);
            let autoRandomize:string = localStorage.getItem(Config.LOCAL_STORAGE_KEY_AUTO_RANDOMIZE);
            this.autoRandomize = autoRandomize == 'true';
        } else {
            this.clientSeed = Math.floor(Math.random()*100000);
            this.autoRandomize = true;
            localStorage.setItem(Config.LOCAL_STORAGE_KEY_CLIENT_SEED, this.clientSeed.toString());
            localStorage.setItem(Config.LOCAL_STORAGE_KEY_AUTO_RANDOMIZE, "true");
        }

        this.attachSocketListeners();
    }

    /**
     * Listen for socket events sent from the back-end server
     */
    protected attachSocketListeners():void {

        /**
         * Automatically sent by server upon connecting
         */
        this.socketMessage.getSocket().on(SocketMessage.STC_PAST_WINNERS, (data:any) => {
            data = JSON.parse(data);
            this.initializeWinnersBoard(data.winners);
        });

        /**
         * Client asks for these by sending a CTS_GET_ALL_AUCTIONS message
         */
        this.socketMessage.getSocket().on(SocketMessage.STC_CURRENT_AUCTIONS, (data:any) => {
            data = JSON.parse(data);
            this.guiManager.blockUI(false);
            this.createAuctionElements(data.auctions);
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_AUCTION_UPDATE, (data:any) => {
            data = JSON.parse(data);
            let selector:string = ".external-transaction-link-" + data.auctionId;
            $(selector).removeClass("d-none");
            $(selector).find("a").attr("href", Config.TX_INFO_LINK_PREFIX[this.eosNetwork] + data.transactionId);
            (<any> $(selector)).animateCss('bounceIn');
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_REMOVE_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("Remove auction");
            console.log(auction);
            console.log("====================");

            // Removes all elements of the type specified by the auction parameter
            for (let i:number = 0; i < this.auctionElements.length; i++) {
                let $elem:JQuery<HTMLElement> = this.auctionElements[i];
                let auctionToCheck:any = $elem.data("auction");
                if (auctionToCheck.type == auction.type) {
                    this.auctionElements.splice(i, 1);
                    $elem.detach();
                }
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_ADD_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("Add auction");
            console.log(auction);
            console.log("====================");
            this.insertNewAuctionElement(auction);
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_CHANGE_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("Change auction");
            console.log(auction);
            console.log("====================");
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.type == auction.type);
            });

            let currentAuctionData:any = $auctionElementToUpdate.data("auction");
            if ((currentAuctionData.last_bid_id != auction.last_bid_id)) {
                $auctionElementToUpdate.data("animateOdometer", false);
            }
            if ((currentAuctionData.last_bid_id != auction.last_bid_id) && this.accountInfo && (this.accountInfo.account_name == currentAuctionData.last_bidder)) {
                let ttBonus: number = this.timeTokenEarnedByLeader(currentAuctionData, Math.floor(new Date().getTime()/1000));
                if (ttBonus > 0) {
                    let message:string = '<div style="margin-left:auto; margin-right:auto; padding-left: 55px;">' + ttBonus.toFixed(4) + " TIME Bonus</div>";
                    this.flashAuctionMessage($auctionElementToUpdate, message);
                    let evt:CustomEvent = new CustomEvent("updateCoinBalances", {});
                    document.dispatchEvent(evt);
                }
            }

            if ($auctionElementToUpdate) {
                $auctionElementToUpdate.find(this.selectors.auctionInstanceBusy).addClass("d-none");
                $auctionElementToUpdate.data("auction", auction);
                this.updateAuctionElement($auctionElementToUpdate);
            }

            if (this.accountInfo && auction.last_bidder == this.accountInfo.account_name) {
                let evt:CustomEvent = new CustomEvent("updateCoinBalances", {});
                document.dispatchEvent(evt);
                $auctionElementToUpdate.find(".auction-instance-bid-button").blur();
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_END_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("End auction");
            console.log(auction);
            console.log("====================");
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.type == auction.type);
            });
            if ($auctionElementToUpdate) {
                let currentAuctionData:any = $auctionElementToUpdate.data("auction");
                let currentAuctionLastBidder:string = currentAuctionData.last_bidder;
                let currentStatus:string = currentAuctionData.status;
                $auctionElementToUpdate.data("auction", auction);
                if (currentStatus != "ended") {
                    this.updateAuctionElement($auctionElementToUpdate, false);
                }
            }

            (<any> $auctionElementToUpdate).animateCss('bounceIn');
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_WINNER_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("Winner auction");
            console.log(auction);
            console.log("====================");

            this.addWinnerToLeaderBoard(auction, !Config.LIMITED_MOBILE_UI);

            if (this.accountInfo && auction.last_bidder == this.accountInfo.account_name) {
                setTimeout(() => {
                    let evt:CustomEvent = new CustomEvent("updateCoinBalances", {});
                    document.dispatchEvent(evt);
                }, 3000);
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_BID_SIGNATURE, (payload:any) => {
            payload = JSON.parse(payload);
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.type == payload.auctionType);
            });
            if ($auctionElementToUpdate) {
                let auction:any = <any> $auctionElementToUpdate.data("auction");
                if (payload.signature == "HARPOON") {

                } else if (payload.signature == "CAPTCHA-REQUIRED") {
                    if (CAPTCHA_LOADED) {
                        (<any> $("#captcha_modal")).data("auctionId", auction.id);
                        (<any> $("#captcha_modal")).modal("show");
                    }
                } else if (payload.signature == "TERMS") {
                    let evt:CustomEvent = new CustomEvent("termsAndConditions", {"detail": null});
                    document.dispatchEvent(evt);
                } else {
                    this._eosBid($auctionElementToUpdate, payload.signature);
                }
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_UPDATE_SERVER_HASH, (payload:any) => {
            payload = JSON.parse(payload);
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.id == payload.auctionId);
            });
            if ($auctionElementToUpdate) {
                let auction:any = $auctionElementToUpdate.data("auction");
                auction.serverSeedHash = payload.serverSeedHash;
                this.updateServerSeedHash($auctionElementToUpdate, auction);
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_HARPOON_SIGNATURE, (payload:any) => {
            payload = JSON.parse(payload);
            if (payload.status == "TERMS") {
                let evt:CustomEvent = new CustomEvent("termsAndConditions", {"detail": null});
                document.dispatchEvent(evt);
            } else {
                if (this.accountInfo) {
                    let $auctionElementToHarpoon: JQuery<HTMLElement> = this.auctionElements.find(($elem: JQuery<HTMLElement>) => {
                        let auctionToCheck: any = $elem.data("auction");
                        return (auctionToCheck.id == payload.auctionId);
                    });
                    if ($auctionElementToHarpoon) {
                        if (payload.status == "pending") {
                            if ($auctionElementToHarpoon) {

                                let reportError = (reason: string) => {
                                    let ha: HarpoonAnimation = <HarpoonAnimation> $auctionElementToHarpoon.data("harpoonAnimation");
                                    ha.stop();
                                    let messageObj: any = {
                                        english: "Unexpected error while posting transaction to EOS blockchain, see console for details",
                                        chinese: "将事务发布到EOS区块链时出现意外错误，请参阅控制台了解详细信息。"
                                    };
                                    let errorMessage: string = Config.safeProperty(reason, ["error.details.message"], null);
                                    if (errorMessage && errorMessage.indexOf("expected key different") > 0) {
                                        messageObj.english = "Your harpoon came in after the auction state had changed.";
                                        messageObj.chinese = "在拍卖状态发生变化后，你的鱼叉进来了。";
                                    }
                                    this.notifyPopup({english: "Harpoon Rejected!", chinese: "鱼叉被拒绝了"}, messageObj);
                                    console.log(reason);
                                };

                                let auction: any = $auctionElementToHarpoon.data("auction");
                                auction.harpoons[this.accountInfo.account_name] = payload;
                                this.updateAuctionElementButtonState($auctionElementToHarpoon, auction);
                                let ha: HarpoonAnimation = <HarpoonAnimation> $auctionElementToHarpoon.data("harpoonAnimation");
                                try {
                                    this.eosHarpoon_($auctionElementToHarpoon, payload.accountName, payload.signature, payload.auctionId).then((result) => {
                                        ha.stop();
                                    }, (reason) => {
                                        reportError(reason);
                                    });
                                } catch (err) {
                                    reportError(err);
                                }
                            }
                        } else if (payload.status == "miss") {
                            let ha: HarpoonAnimation = <HarpoonAnimation> $auctionElementToHarpoon.data("harpoonAnimation");
                            ha.miss(payload);
                            let auction: any = $auctionElementToHarpoon.data("auction");
                            auction.harpoons[this.accountInfo.account_name] = payload;
                            this.updateAuctionElementButtonState($auctionElementToHarpoon, auction);
                        } else if (payload.hasOwnProperty("message")) {
                            this.notifyPopup({english: "Harpoon Missed!", chinese: "鱼叉错过了！"}, payload.message);
                            if ($auctionElementToHarpoon) {
                                let ha: HarpoonAnimation = <HarpoonAnimation> $auctionElementToHarpoon.data("harpoonAnimation");
                                ha.stop();
                            }
                        }
                    }
                }
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_LEADER_CLIENT_SEED, (payload:any) => {
            payload = JSON.parse(payload);
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.id == payload.auctionId);
            });
            if ($auctionElementToUpdate) {
                let auctionData:any = $auctionElementToUpdate.data("auction");
                auctionData.clientSeed = payload.clientSeed;
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_CAPTCHA_RESPONSE, (payload:any) => {
            payload = JSON.parse(payload);

            if (payload && payload["error-codes"] && (payload["error-codes"].length > 0) && (payload["error-codes"][0] == "timeout-or-duplicate")) {
                this.notifyPopup({english: "CAPTCHA Failed", chinese: "CAPTCHA失败"}, {english: "The CAPTCHA timed out or was a dupicate", chinese: "CAPTCHA超时或是重复"});
                (<any> $("#captcha_modal")).modal("hide");
            } else {
                if (payload.success) {
                    $("#captcha_modal").data("captcha", true);
                } else {
                    $("#captcha_modal").data("captcha", false);
                }
            }
            console.log("captcha response from google: ");
            console.log(payload);
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_HARPOON_ATTEMPT, (payload:any) => {
            payload = JSON.parse(payload);
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.id == payload.auctionId);
            });
            if ($auctionElementToUpdate) {
                let status:string = payload.status == "miss" ? " miss" : "";
                let m:string = '<div style="margin-left:auto; margin-right:auto; padding-left: 40px;"><img src="assets/images/harpoon.png" style="width: 20px; height: 20px;"><span class="auction-instance-harpoon-account" style="padding-left: 5px;">' + payload.accountName + status + '</span></div>';
                let ha:HarpoonAnimation = $auctionElementToUpdate.data("harpoonAnimation");
                if (ha.isAnimating()) {
                    $auctionElementToUpdate.data("harpoonMessage", m);
                } else {
                    this.flashAuctionMessage($auctionElementToUpdate, m);
                }
            }
        });
    }

    /**
     * Flashes a message on an auction card
     *
     * @param {JQuery<HTMLElement>} $elem
     * @param {string} message
     */
    private flashAuctionMessage($elem:JQuery<HTMLElement>, message:string) {
        let messageQueue:string[] = $elem.data("messageQueue");
        if (!messageQueue) {
            messageQueue = new Array<string>();
        }
        messageQueue.push(message);
        let messageToFlash:string = messageQueue.shift();

        console.log("Message to flash: " + messageToFlash);

        let $toFlash:JQuery<HTMLElement> = $elem.find(".auction-instance-flash-message");
        $toFlash.html(messageToFlash);

        (<any> $toFlash).animateCss("fadeIn", () => {
            (<any> $toFlash).animateCss("fadeOut", () => {
                console.log("Fade In");
                if (messageQueue.length > 0) {
                    messageToFlash = messageQueue.shift();
                    this.flashAuctionMessage($elem, messageToFlash);
                }
                console.log("Fade Out");
            });
        });
    }

    /**
     * Attach listeners for the GUI messages
     */
    protected attachGUIHandlers():void {

        super.attachGUIHandlers();

        $(document).on("captchaData", (event) => {
            let payload:any = (<any> event).detail;
            this.onCaptchaData(payload);
        });

        $(document).on("captchaDataExpired", (event) => {
            this.onCaptchaDataExpired();
        });

        $("#captcha_modal").on("show.bs.modal", () => {

            let $elem:JQuery<HTMLElement> = jQuery('<div/>', {
                id: 'captcha_container',
                title: 'reCaptcha'
            }).appendTo('#captcha_outer_container');

            grecaptcha.render('captcha_container', {
                'sitekey': '6LfmvYkUAAAAAHf3ciU0o_UgVC4tEiPxSWMVLTve',
                'callback': onCaptchaData,
                'expired-callback': onCaptchaDataExpired
            });

            $(".auction-captcha-account-name-input").val("");
            $("#captcha_modal").data("captcha", false);
        });

        $("#captcha_modal").on("hide.bs.modal", () => {

            $("#captcha_outer_container").empty();
        });

        $("#captcha_modal").on("shown.bs.modal", () => {
            $(".auction-captcha-account-name-input").focus();
        });

        $(".auction-captcha-submit").on("click", (event) => {
            let accountName:string = <string> $(".auction-captcha-account-name-input").val();
            if (accountName != this.accountInfo.account_name) {
                this.notifyPopup({english: "Incorrect Account Name", chinese: "帐户名称不正确"}, {english: "Please enter your account name.", chinese: "请输入您的帐户名称。"});
            } else {
                let captcha:boolean = $("#captcha_modal").data("captcha");
                if (!captcha) {
                    this.notifyPopup({english: "Incorrect CAPTCHA", chinese: "不正确 CAPTCHA"}, {english: "Please complete the CAPTCHA.", chinese: "请完成 CAPTCHA"});
                } else {
                    // All is good, so submit the form.
                    let auctionId:number = $("#captcha_modal").data("auctionId");
                    let token:string = $("#captcha_modal").data("captchaToken");
                    this.socketMessage.ctsCaptchaSubmit(token, auctionId);
                    this.notifyPopup({english: "Bidding Enabled", chinese: "出价已启用"}, {english: "You may now bid freely in auction id: " + auctionId.toString(), chinese: "您现在可以在拍卖ID中自由出价："});
                }
                (<any> $("#captcha_modal")).modal("hide");
            }
        });

        (<any> $(".auction-client-seed-input")).inputFilter(function(value) {
            let ok:boolean = /^\d*$/.test(value) && (value === "" || parseInt(value) <= 100000);
            return ok;
        });

        $("#auction_details_modal").on("show.bs.modal", (event) => {
            let auction:any = $("#auction_details_modal").data("auction");
            let $elem = $("#auction_details_modal");
            $elem.find(".auction-details-modal-winner").text(auction.last_bidder);
            if ((auction.flags & 0x08) == 0x08) {
                $elem.find(".auction-details-modal-harpooned").removeClass("d-none");
            } else {
                $elem.find(".auction-details-modal-harpooned").addClass("d-none");
            }
            let prizePool:string = (typeof auction.prize_pool == "string") ? auction.prize_pool : auction.prize_pool.toFixed(4);
            $elem.find(".auction-details-modal-prize").text(prizePool);
            $elem.find(".auction-details-modal-bidders").empty();
            $elem.find(".auction-details-harpoons").empty();
            $elem.find(".auction-details-modal-player-seed-outer").addClass("d-none");
            $elem.find(".auction-details-modal-server-seed-outer").addClass("d-none");
            for (let bidder of auction.bidders) {
                let $e:JQuery<HTMLElement> = $(".auction-details-bid-template").clone().removeClass("auction-details-bid-template").removeClass("d-none");
                $e.find(".auction-details-bidder-name").text(bidder.accountName);
                $e.find(".auction-details-bidder-amount").text(bidder.amount.toFixed(4) + " EOS");
                $elem.find(".auction-details-modal-bidders").append($e);
            }
            $elem.find(".auction-details-harpoons-outer").addClass("d-none");
            for (let key in auction.harpoons) {
                $elem.find(".auction-details-harpoons-outer").removeClass("d-none");
                let $e:JQuery<HTMLElement> = $(".auction-details-harpoon-template").clone().removeClass("auction-details-harpoon-template").removeClass("d-none");
                $e.find(".auction-details-harpoon-name").text(key);
                $e.find(".auction-details-odds-amount").text((auction.harpoons[key]["odds"]*100).toFixed(2) + " %");
                $elem.find(".auction-details-harpoons").append($e);
                if (auction.harpoons[key]["status"] == "success") {
                    $e.addClass("text-success");
                    $elem.find(".auction-details-modal-player-seed-outer").removeClass("d-none");
                    $elem.find(".auction-details-modal-server-seed-outer").removeClass("d-none");
                    $elem.find(".auction-details-modal-player-seed").text(auction.harpoons[key]["clientSeed"]);
                    $elem.find(".auction-details-modal-server-seed").text(auction.harpoons[key]["serverSeed"]);
                }
            }
            console.log("modal data");
            console.log(auction);
        });

        $("#provably_fair_modal").on("hidden.bs.modal", (event) => {
            this.clientSeed = parseInt(<string> ($("#provably_fair_modal").find(".auction-client-seed-input").val()));
            this.autoRandomize = ($("#provably_fair_modal").find(".auction-client-seed-randomize").prop('checked'));
            localStorage.setItem(Config.LOCAL_STORAGE_KEY_CLIENT_SEED, this.clientSeed.toString());
            localStorage.setItem(Config.LOCAL_STORAGE_KEY_AUTO_RANDOMIZE, this.autoRandomize ? "true" : "false");
        });

        // Listen for new socketMessage
        $(document).on("updateSocketMessage", (event) => {
            this.socketMessage = <any> event.detail;
            this.attachSocketListeners();
        });

        // Network change
        $(document).on("updateEosNetwork", (event) => {
            this.eosNetwork = <any> event.detail;
        });

        $(document).on("initializeGameGUI", (event) => {
            this.socketMessage.ctsGetAllAuctions();
            this.socketMessage.ctsGetWinnersList();
        });

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
            if (this.eos) {
                this.socketMessage.ctsGetAllAuctions();
            }
        });

        $(document).on("setReferrer", (event) => {
            let referrer:any = event.detail;
            this.referrer = <string> referrer;
        });

        $(document).on("currentLanguage", (event) => {

            let language:any = event.detail;
            this.currentLanguage = language;

            // Fix auctions
            let localThis:AuctionManager = this;
            $(this.selectors.auctionInstancesContainer).children().each(function (idx:number) {
                const $elem:JQuery<HTMLElement> = $(this);
                const auction:any = $elem.data("auction");
                $elem.find(localThis.selectors.auctionInstanceBidderOuter).addClass("d-none");
                $elem.find(localThis.selectors.auctionInstanceNoBidder).addClass("d-none");
                if (auction.last_bidder == Config.EOSTIME_CONTRACT) {
                    $elem.find(localThis.selectors.auctionInstanceNoBidder).removeClass("d-none");
                } else {
                    $elem.find(localThis.selectors.auctionInstanceBidderOuter).removeClass("d-none");
                }
            });
        });

        $(document).on("acceptedTerms", (event) => {
            this.accountInfo.acceptedTerms = true;
        });
    }

    protected socketConnected():void {
        super.socketConnected();
    }

    protected setLoggedInView(account:any, accountInfo:any):void {
        super.setLoggedInView(account, accountInfo);
        let localThis:AuctionManager = this;
        $(this.selectors.auctionInstancesContainer).children().each(function (idx:number) {
            const $elem:JQuery<HTMLElement> = $(this);
            const auction:any = $elem.data("auction");
            localThis.updateAuctionElementButtonState($elem, auction);
        });
    }

    protected setLoggedOutView():void {
        super.setLoggedOutView();
        let localThis:AuctionManager = this;
        $(this.selectors.auctionInstancesContainer).children().each(function (idx:number) {
            const $elem:JQuery<HTMLElement> = $(this);
            const auction:any = $elem.data("auction");
            localThis.updateAuctionElementButtonState($elem, auction);
        });
    }

    /**
     * Round trip to server to validate the CAPTCHA (passing the auctionId
     * set when the captcha dialog was initially popped up).
     * @param {string} token
     */
    protected onCaptchaData(token:string):void {
        let auctionId:number = $("#captcha_modal").data("auctionId");
        $("#captcha_modal").data("captchaToken", token);
        this.socketMessage.ctsCaptchaResponse(token, auctionId);
    }

    protected onCaptchaDataExpired():void {
        this.notifyPopup({english: "Expired CAPTCHA", chinese: "已过期 CAPTCHA"}, {english: "The CAPTCHA expired, please try again.", chinese: "CAPTCHA 已过期，请再试一次。"});
        (<any> $("#captcha_modal")).modal("hide");
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Notifies the user of an event
     * @param titleObj
     * @param messageObj
     */
    private notifyPopup(titleObj:any, messageObj:any):void {
        let title:string;
        let message:string;
        switch(this.currentLanguage) {
            case 'english':
                title = titleObj.english;
                message = messageObj.english;
                break;
            case 'chinese':
                title = titleObj.chinese;
                message = messageObj.chinese;
                break;
        }
        (<any> $).notify({
            title: title,
            message: message
        },{
            type: "info",
            allow_dismiss: false,
            delay: 4000,
            z_index: 10000,
            placement: {
                from: "top",
                align: "center"
            },
            template: '<div data-notify="container" class="col-xs-11 col-sm-3 alert alert-{0}" role="alert">' +
            '<button type="button" aria-hidden="true" class="close" data-notify="dismiss">×</button>' +
            '<span data-notify="icon"></span> ' +
            '<div data-notify="title"><i class="fas fa-gavel"></i>&nbsp;&nbsp;<strong>{1}</strong></div> ' +
            '<div><hr /></div>' +
            '<div data-notify="message" class="pb-1">{2}</div>' +
            '<div class="progress" data-notify="progressbar">' +
            '<div class="progress-bar progress-bar-{0}" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>' +
            '</div>' +
            '<a href="{3}" target="{4}" data-notify="url"></a>' +
            '</div>'
        });
    }

    private initializeWinnersBoard(winners:any[]):void {
        $(this.selectors.auctionWinnersInner).empty();
        for (let i:number = winners.length - 1; i >= 0; i--) {
            let auction:any = winners[i];
            this.addWinnerToLeaderBoard(auction, false);
        }
    }

    private addWinnerToLeaderBoard(auction:any, playAnimation:boolean = true):void {

        /* An auction structure looks like this:
        *  {
        *      bid_multiplier_x100k: 105000
        *      bid_price: "0.0300"
        *      bidder_timecoins_per_eos: 50
        *      block_time: 1542635132
        *      creation_time: 1542635122
        *      enabled: 1
        *      expires: 1542635152
        *      house_portion_x100k: 9625
        *      id: 11659
        *      init_bid_count: 25
        *      init_bid_price: "0.0300 EOS"
        *      init_duration_secs: 30
        *      init_prize_pool: "0.2500 EOS"
        *      init_redzone_secs: 15
        *      last_bidder: "eostimecontr"
        *      paid_out: 0
        *      prize_pool: "0.2500"
        *      referrer_portion_x100k: 375
        *      remaining_bid_count: 25
        *      status: "active"
        *      type: 1000
        *      winner_timecoins_per_eos: 10,
        *      blockNumber: <optional>,
        *      transactionId: <optional>
        *  }
        */

        let start:Moment = moment.unix(auction.creation_time);
        let end:Moment = moment.unix(auction.expires);
        let diff:number = end.diff(start);
        let duration:string = moment.utc(diff).format("HH:mm:ss.SSS");

        let $clone:JQuery<HTMLElement> = $(this.selectors.auctionWinnerInstanceTemplate).clone().removeClass(this.selectors.auctionWinnerInstanceTemplate.substr(1)).removeClass("d-none");
        $clone.find(this.selectors.auctionWinnerInstanceId).text(auction.type + "-" + auction.id);
        $clone.find(this.selectors.auctionWinnerInstanceName).text(auction.last_bidder);
        $clone.find(this.selectors.auctionWinnerInstanceAmount).text(auction.prize_pool);
        $clone.find(this.selectors.auctionWinnerInstanceDuration).text(duration);
        $clone.find(this.selectors.auctionWinnerInstanceTime).text(end.format("h:mm a"));
        $(this.selectors.auctionWinnersInner).prepend($clone);

        // Handle getting more details on a winning auction
        $clone.find(this.selectors.auctionWinnerShowDetail).on("click", (event) => {
            $("#auction_details_modal").data("auction", auction);
            (<any> $("#auction_details_modal")).modal("show");
        });

        let blockNumber:number = Config.safeProperty(auction, ["blockNumber"], null);
        let transactionId:number = Config.safeProperty(auction, ["transactionId"], null);
        if (blockNumber && transactionId) {
            $clone.find(this.selectors.auctionWinnerInstanceIdLink).removeClass("d-none");
            $clone.find(this.selectors.auctionWinnerInstanceIdLink).find("a").attr("href", Config.TX_INFO_LINK_PREFIX[this.eosNetwork] + transactionId);
        }
        $clone.find(this.selectors.auctionWinnerInstanceIdLink).addClass("external-transaction-link-" + auction.id);

        // See if we were harpooned.
        if ((auction.flags & 0x08) == 0x08) {
            $clone.find(this.selectors.auctionWinnersHarpoon).removeClass("d-none");
        }

        // Show confetti animation if we aren't currently running one
        if (playAnimation) {
            if (this.confetti === null) {
                this.confetti = new Confetti($(this.selectors.auctionWinners)[0]);
                this.confetti.startConfetti();
                setTimeout(() => {
                    this.confetti.stopConfetti();
                    setTimeout(() => {
                        this.confetti.removeConfetti();
                        this.confetti = null;
                    }, 1500);
                }, 1000);
            }
        }

        // If there are more than the max in the winner board, purge
        // the oldest one.
        if ($(this.selectors.auctionWinnersInner).children().length > Config.MAX_WINNERS_IN_GUI) {
            $(this.selectors.auctionWinnersInner).children().last().remove();
        }
    }

    /**
     * Inserts a new auction into the DOM
     * @param auction
     */
    private insertNewAuctionElement(auction:any):void {
        let $clone = $(this.selectors.auctionTemplate).clone()
            .removeClass("d-none")
            .removeClass(this.selectors.auctionTemplate.substr(1))
            .attr("id", "auction_id_" + auction.id);
        $clone.data("auction", auction);
        this.auctionElements.push($clone);
        this.auctionElements.sort((a:any, b:any):number => {
            const aa:any = a.data("auction");
            const ba:any = b.data("auction");
            const af:number = parseFloat(aa.type);
            const bf:number = parseFloat(ba.type);
            if (af > bf) {
                return -1;
            } else if (af < bf) {
                return 1;
            } else {
                return 0;
            }
        });
        this.initializeAuctionElement($clone, auction);

        let didInsert:boolean = false;
        $(this.selectors.auctionInstancesContainer).children().each(function(idx:number) {
            const $child:JQuery<HTMLElement> = $(this);
            const existingAuction:any = $child.data("auction");
            const newType:number = parseFloat(auction.type);
            const existingType:number = parseFloat(existingAuction.type);
            if (newType > existingType) {
                $clone.insertBefore($child);
                didInsert = true;
                return false;
            }
        });

        // Turn tool tips on for serverSeedHash
        $clone.find(this.selectors.auctionServerHash).attr("data-toggle", "tooltip").attr("data-placement","bottom");
        (<any> $clone.find(this.selectors.auctionServerHash)).tooltip();

        if (!didInsert) {
            $(this.selectors.auctionInstancesContainer).append($clone);
        }
    }

    /**
     * Creates our initial auction GUI elements
     * @param {any[]} auctions
     */
    private createAuctionElements(auctions:any[]):void {
        auctions.sort((a:any, b:any):number => {
            const af:number = parseFloat(a.type);
            const bf:number = parseFloat(b.type);
            if (af > bf) {
                return -1;
            } else if (af < bf) {
                return 1;
            } else {
                return 0;
            }
        });
        $(this.selectors.auctionInstancesContainer).empty();
        this.auctionElements = new Array<JQuery<HTMLElement>>();
        for (let auction of auctions) {
            let $clone = $(this.selectors.auctionTemplate).clone()
                .removeClass("d-none")
                .removeClass(this.selectors.auctionTemplate.substr(1))
                .attr("id", "auction_id_" + auction.id);
            $clone.data("auction", auction);
            this.auctionElements.push($clone);
            this.initializeAuctionElement($clone, auction);
            $(this.selectors.auctionInstancesContainer).append($clone);

            // Turn tool tips on for serverSeedHash
            $clone.find(this.selectors.auctionServerHash).attr("data-toggle", "tooltip").attr("data-placement","bottom");
            (<any> $clone.find(this.selectors.auctionServerHash)).tooltip();
        }
        $(this.selectors.mainAuctionArea).removeClass("d-none");
        $(this.selectors.auctionInstancesLoading).addClass("d-none");
    }

    /**
     * Update the button state on a particular auction element
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private updateAuctionElementButtonState($elem:JQuery<HTMLElement>, auction: any):void {
        if (this.accountInfo == null) {
            $elem.find(this.selectors.auctionInstanceLoginButton).removeClass("d-none");
            $elem.find(".bid-button-container").addClass("d-none");
            $elem.find(this.selectors.auctionInstanceEnded).addClass("d-none");
        }  else {
            $elem.find(this.selectors.auctionInstanceLoginButton).addClass("d-none");
            if (auction.status == "ended") {
                $elem.find(".bid-button-container").addClass("d-none");
                $elem.find(this.selectors.auctionInstanceEnded).removeClass("d-none");
            } else {
                $elem.find(".bid-button-container").removeClass("d-none");
                $elem.find(this.selectors.auctionInstanceEnded).addClass("d-none");
            }

            let disableBid = ($elem:JQuery<HTMLElement>) => {
                $elem.find(this.selectors.auctionInstanceBidButton).addClass('btn-disabled').attr('disabled', 'disabled').prop('disabled', true);
            }
            let enableBid = ($elem:JQuery<HTMLElement>) => {
                $elem.find(this.selectors.auctionInstanceBidButton).removeClass('btn-disabled').removeAttr('disabled').prop('disabled', false);
            }

            let disableHarpoon = ($elem:JQuery<HTMLElement>) => {
                $elem.find(this.selectors.auctionBombButton).addClass('btn-disabled').attr('disabled', 'disabled').prop('disabled', true);
                $elem.find(this.selectors.auctionBombOdds).text("------");
            }
            let enableHarpoon = ($elem:JQuery<HTMLElement>) => {
                $elem.find(this.selectors.auctionBombButton).removeClass('btn-disabled').removeAttr('disabled').prop('disabled', false);
                let odds:string = (auction.odds[this.accountInfo.account_name].odds*100).toFixed(2);
                $elem.find(this.selectors.auctionBombOdds).text(odds + " %");
            }

            if ((auction.harpoon > 0) && (this.hasHarpooned(auction))) {
                disableBid($elem);
            } else {
                enableBid($elem);
            }

            if (auction.hasOwnProperty("odds") && auction.odds.hasOwnProperty(this.accountInfo.account_name)) {
                if (auction.odds[this.accountInfo.account_name].odds === 0) {
                    disableHarpoon($elem);
                } else {
                    if (this.hasHarpooned(auction)) {
                        disableHarpoon($elem);
                    } else {
                        if (auction.harpoonMinBids > 0 && auction.bidders.length >= auction.harpoonMinBids) {
                            if ((auction.flags & 0x10) == 0x10) {
                                // We are paused
                                disableHarpoon($elem);
                            } else {
                                enableHarpoon($elem);
                            }
                        } else {
                            disableHarpoon($elem);
                        }
                    }
                }
            } else {
                disableHarpoon($elem);
            }
        }
    }

    /**
     * Initializes an auction GUI element from an auction data structure that looks like this:
     *
     * {
     *      bid_multiplier_x100k: 105000
     *      bid_price: "0.0300"
     *      bidder_timecoins_per_eos: 50
     *      block_time: 1542635132
     *      creation_time: 1542635122
     *      enabled: 1
     *      expires: 1542635152
     *      house_portion_x100k: 9625
     *      id: 11659
     *      init_bid_count: 25
     *      init_bid_price: "0.0300 EOS"
     *      init_duration_secs: 30
     *      init_prize_pool: "0.2500 EOS"
     *      init_redzone_secs: 15
     *      last_bidder: "eostimecontr"
     *      paid_out: 0
     *      prize_pool: "0.2500"
     *      referrer_portion_x100k: 375
     *      remaining_bid_count: 25
     *      status: "active"
     *      type: 1000
     *      winner_timecoins_per_eos: 10
     * }
     *
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private initializeAuctionElement($elem:JQuery<HTMLElement>, auction: any): void {

        // Attach our harpoon animation class
        let ha:HarpoonAnimation = new HarpoonAnimation($elem.find(this.selectors.auctionInstanceHarpoonOverlay), () => {
            let message:string = $elem.data("harpoonMessage");
            if (message) {
                this.flashAuctionMessage($elem, message);
                $elem.removeData("harpoonMessage");
            }
        });
        $elem.data("harpoonAnimation", ha);

        $elem.find(this.selectors.ribbonContainer).empty();
        if (auction.hasOwnProperty("html")) {
            $elem.find(this.selectors.ribbonContainer).html(auction.html);
        }

        let $clockAcceleratesMesage:JQuery<HTMLElement> = $elem.find(".auction-instance-clock-accelerates-message");
        if (auction.clock_multiplier_x100k == 0.0) {
            $clockAcceleratesMesage.addClass("d-none");
        } else {
            $clockAcceleratesMesage.removeClass("d-none");
            (<any> $clockAcceleratesMesage).find('div').animateCss('pulse infinite');
        }

        let $minBidsMessage:JQuery<HTMLElement> = $elem.find(".auction-instance-min-bids-message");
        if ((auction.flags & 0x10) != 0x10) {
            $minBidsMessage.addClass("d-none");
        } else {
            let moreBids:number = auction.minBids  - (auction.init_bid_count - auction.remaining_bid_count);
            let message:string = (<any>$).t("minimum_bids", {count: moreBids});
            GUIManager.I18N["minimum_bids"] = {"elem": $minBidsMessage.find("div"), "params": {count: moreBids}};
            $minBidsMessage.removeClass("d-none");
            $minBidsMessage.find("div").html(message);
            (<any> $minBidsMessage).find('div').animateCss('pulse infinite');
        }

        $elem.find(this.selectors.auctionInstanceId).text(auction.type.toString() + "-" + auction.id.toString());
        $elem.find(this.selectors.auctionInstanceBidderOuter).addClass("d-none");
        $elem.find(this.selectors.auctionInstanceNoBidder).addClass("d-none");
        if (auction.last_bidder == Config.EOSTIME_CONTRACT) {
            $elem.find(this.selectors.auctionInstanceNoBidder).removeClass("d-none");
        } else {
            $elem.find(this.selectors.auctionInstanceBidderOuter).removeClass("d-none");
        }
        $elem.find(this.selectors.auctionInstanceBidder).text(auction.last_bidder);
        $elem.find(this.selectors.auctionInstanceBloksLink).attr("href", Config.ACCOUNT_INFO_LINK_PREFIX[this.eosNetwork] + auction.last_bidder);
        $elem.find(this.selectors.auctionInstancePrizePool).text(auction.prize_pool);
        $elem.find(this.selectors.auctionInstanceRemainingBids).text(auction.remaining_bid_count);
        $elem.find(this.selectors.auctionInstanceBidAmount).text(auction.bid_price);

        // Deal with odometer
        let $odometer:JQuery<HTMLElement> = $elem.find(this.selectors.auctionInstanceTimeTokenOdometer);
        let o:any = new Odometer({
            el: $odometer[0],
            theme: "default",
            format: '(,ddd).dddd'
        });
        $elem.data("odometer", o);
        $elem.data("animateOdometer", true);
        if (auction.timecoins_per_second_bonus_x100k == 0) {
            $elem.find(this.selectors.auctionInstanceBonusTimeContainer).addClass("d-none");
        } else {
            $elem.find(this.selectors.auctionInstanceBonusTimeContainer).removeClass("d-none");
        }

        // Deal with harpoon functionality
        //
        if (!auction.hasOwnProperty("harpoon") || auction.harpoon === 0) {
            // Not a harpoonable auction
            $elem.find(".bomb-button-col").addClass("d-none");
            $elem.find(".bid-button-col").removeClass("col-7").addClass("col-12");
            $elem.find(".bid-button-container").addClass("pl-5").addClass("pr-5");
        } else {

            // Client Seed Hash
            if (auction.clientSeed) {
                $elem.find(this.selectors.auctionClientSeed).removeClass("d-none").text(auction.clientSeed);
            } else {
                $elem.find(this.selectors.auctionClientSeed).addClass("d-none");
            }
            $elem.find(".auction-client-seed-container").removeClass("d-none");

            // Server Seed
            $elem.find(this.selectors.auctionServerHash).text(this.trimServerSeedHash(auction.serverSeedHash));
            $elem.find(this.selectors.auctionServerHash).attr("title", auction.serverSeedHash);
            $elem.find(this.selectors.auctionServerHash).attr("data-original-title", auction.serverSeedHash);
            (<any> $elem.find(this.selectors.auctionServerHash)).tooltip('hide');
            $elem.find(".auction-server-hash-container").removeClass("d-none");
        }

        $elem.data("lastUpdateTime", Math.floor(new Date().getTime()/1000));
        this.updateAuctionElementButtonState($elem, auction);
        this.updateRemainingTime($elem);
        this.updateBonusTimeTokens($elem);
        $elem.find(this.selectors.auctionInstanceBidButton).on("click", (event) => {


            let $currentTarget:JQuery<HTMLElement> = $(event.currentTarget);
            let $auctionElement:JQuery<HTMLElement> = $currentTarget.closest(this.selectors.auctionInstance);
            this.eosBid($auctionElement).then((result) => {
                $currentTarget.blur();
            }).catch((err) => {
                $currentTarget.blur();
                console.log(err);
            });
        });

        $elem.find(this.selectors.auctionBombButton).on("click", (event) => {
            let $currentTarget:JQuery<HTMLElement> = $(event.currentTarget);
            let $auctionElement:JQuery<HTMLElement> = $currentTarget.closest(this.selectors.auctionInstance);
            this.eosHarpoon($auctionElement).then((result) => {
                $currentTarget.blur();
            }).catch((err) => {
                $currentTarget.blur();
                console.log(err);
            });
        });

        $elem.find(".auction-instance-server-hash-info").on("click", (event) => {

            // Initialize the client seed and autorandomize checkbox
            $('#provably_fair_modal').find(".auction-client-seed-input").val(this.clientSeed.toString());
            if (this.autoRandomize) {
                $('#provably_fair_modal').find(".auction-client-seed-randomize").attr("checked", "true");
            } else {
                $('#provably_fair_modal').find(".auction-client-seed-randomize").removeAttr("checked");
            }

            (<any> $('#provably_fair_modal')).modal('show');
        });

        $elem.find(".auction-instance-harpoon-info").on("click", (event) => {
            let auction:any = $(event.currentTarget).parents(this.selectors.auctionInstance).data("auction");
            let harpoon:string = ((1 - auction.harpoon) * 100).toFixed(2) + "%";
            if ((auction.harpoonMinBids > 0) && (auction.harpoon > 0)) {
                $("#harpoon_desc_modal").find(".harpoonMinBids").removeClass("d-none");
                $("#harpoon_desc_modal").find(".harpoonMinBids span").text(auction.harpoonMinBids.toString());
            } else {
                $("#harpoon_desc_modal").find(".harpoonMinBids").addClass("d-none");
            }
            $("#harpoon_desc_modal").find(".harpoon-survival").text(harpoon);
            (<any> $('#harpoon_desc_modal')).modal('show');
        });

        $elem.find(".auction-instance-info").on("click", (event) => {

            // Hide other content
            $('#info_modal').find(".modal-title-inner").addClass("d-none");
            $('#info_modal').find(".modal-body-inner").addClass("d-none");

            let modalIdentifier:string = $(event.currentTarget).attr('data-id');
            $('#info_modal').find("." + modalIdentifier + "." + this.currentLanguage).removeClass("d-none");

            // Update the fields in the modal
            let auction:any = $(event.currentTarget).parents(this.selectors.auctionInstance).data("auction");
            let $title:JQuery<HTMLElement> = $('#info_modal .modal-title').find("." + modalIdentifier + "." + this.currentLanguage)
            let $body:JQuery<HTMLElement> = $('#info_modal .modal-body').find("." + modalIdentifier + "." + this.currentLanguage)
            $title.find("span").text(auction.type.toString() + " - " + auction.id.toString());
            $body.find(".auction-instance-modal-prize").text(auction.prize_pool);
            $body.find("").addClass("d-none");
            $body.find(".auction-instance-modal-leader").addClass("d-none");
            if (auction.last_bidder == Config.EOSTIME_CONTRACT) {
                let selector:string = ".auction-instance-modal-leader.no-bidders";
                $body.find(".auction-instance-modal-leader.no-bidders").removeClass("d-none");
            } else {
                $body.find(".auction-instance-modal-leader.has-bidders").text(auction.last_bidder).removeClass("d-none");
            }

            let timeTokens:number = auction.bidder_timecoins_per_eos*parseFloat(auction.bid_price);
            $body.find(".auction-instance-modal-time-tokens").text(timeTokens.toFixed(4));

            $body.find(".auction-instance-modal-bid-price").text(auction.bid_price);

            if ((auction.clock_multiplier_x100k != 0) && (auction.clock_multiplier_x100k != 100000)) {
                let val:number = auction.clock_multiplier_x100k/1000;
                val = 100 - val;
                $body.find(".auction-instance-modal-clock-accelerator").text(val.toFixed(2) + "%");
                $body.find(".auction-instance-modal-clock-accelerator-outer").removeClass("d-none");
            } else {
                $body.find(".auction-instance-modal-clock-accelerator-outer").addClass("d-none");
            }

            if (auction.minBids > 0) {
                let val:string = (<any> $).t("auction_instance_min_bids", {count: auction.minBids});
                $body.find(".auction-instance-modal-min-bids").text(val);
                $body.find(".auction-instance-modal-min-bids").removeClass('d-none');
            } else {
                $body.find(".auction-instance-modal-min-bids").addClass('d-none');
            }

            if ((auction.bid_multiplier_x100k != 0.0) && (auction.bid_multiplier_x100k != 100000)) {
                let val:number = auction.bid_multiplier_x100k/1000;
                if (val > 100) {
                    val -= 100;
                }
                $body.find(".auction-instance-modal-bid-price-increase").text(val.toFixed(2) + "%");
                $body.find(".auction-instance-modal-bid-price-increase-outer").removeClass("d-none");
            } else {
                $body.find(".auction-instance-modal-bid-price-increase-outer").addClass("d-none");
            }

            if (auction.harpoon != 0) {
                let harpoon:string = ((1 - auction.harpoon) * 100).toFixed(2) + "%";
                $body.find(".harpoon-survival").text(harpoon);
                $body.find(".auction-instance-modal-harpoonable").removeClass("d-none");
                if (auction.harpoonMinBids > 0) {
                    $body.find(".harpoonMinBids").removeClass("d-none");
                    $body.find(".harpoonMinBids span").text(auction.harpoonMinBids.toString());
                } else {
                    $body.find(".harpoonMinBids").addClass("d-none");
                }
            } else {
                $body.find(".auction-instance-modal-harpoonable").addClass("d-none");
                $body.find(".harpoonMinBids").addClass("d-none");
            }

            $body.find(".auction-instance-modal-remaining-bids").text(auction.remaining_bid_count);

            $body.find(".auction-instance-modal-time-redzone").text(this.friendlyRedzoneTime(auction.init_redzone_secs));

            // Deal with dual red zones
            if (auction.tipping_point_bids_remaining > 0) {
                let val:number = auction.init_bid_count - auction.tipping_point_bids_remaining;
                $body.find(".auction-instance-dual-redzone-bids").text(val);
                $body.find(".auction-instance-modal-time-redzone-fast").text(this.friendlyRedzoneTime(auction.post_tip_redzone_secs))
                $body.find(".auction-instance-dual-redzone-slow").removeClass("d-none");
                $body.find(".auction-instance-dual-redzone-fast").removeClass("d-none");
            } else {
                $body.find(".auction-instance-dual-redzone-slow").addClass("d-none");
                $body.find(".auction-instance-dual-redzone-fast").addClass("d-none");
            }

            // Deal with time for timer!
            if (auction.timecoins_per_second_bonus_x100k > 0) {
                let val:number = auction.timecoins_per_second_bonus_x100k/100000;
                $body.find(".auction-instance-time-token-bonus").text(val.toFixed(4));
                $body.find(".auction-instance-time-for-timer").removeClass("d-none");
            } else {
                $body.find(".auction-instance-time-for-timer").addClass("d-none");
            }

            // Show the auction instance containers (both title and body)
            $('#info_modal').find("." + modalIdentifier + "." + this.currentLanguage).removeClass("d-none");

            // Popup the modal
            (<any> $('#info_modal')).modal('show');
        });
        $elem.find(this.selectors.auctionInstanceLoginButton).on("click", (event) => {
            let evt:CustomEvent = new CustomEvent("logIn", {});
            document.dispatchEvent(evt);
        });
    }

    /**
     * Generates a friendly time for red zone text in auction details popup
     * @param {number} seconds
     * @returns {string}
     */
    private friendlyRedzoneTime(seconds:number):string {
        let hours:number = Math.floor(seconds/3600);
        seconds -= hours*3600;
        let minutes:number = Math.floor(seconds/60);
        seconds -= minutes*60;

        let toRet:string = "";
        if (hours > 0) {
            toRet = hours > 1 ? hours + " hours" : "hour";
        }
        if (minutes > 0) {
            if (toRet.length > 0) {
                toRet += minutes > 1 ? " " + minutes.toString() + " minutes" : "minute";
            } else {
                toRet = minutes > 1 ? minutes.toString() + " minutes" : "minute";
            }
        }
        if (seconds > 0) {
            if (toRet.length > 0) {
                toRet += " and " + seconds.toString() + " seconds";
            } else {
                toRet = seconds > 1 ? seconds.toString() + " seconds" : "second";
            }
        }
        return toRet;
    }

    /**
     * Updates our server seed hash on the auction UI
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private updateServerSeedHash($elem:JQuery<HTMLElement>, auction:any) {
        $elem.find(this.selectors.auctionServerHash).text(this.trimServerSeedHash(auction.serverSeedHash));
        $elem.find(this.selectors.auctionServerHash).attr("title", auction.serverSeedHash);
        $elem.find(this.selectors.auctionServerHash).attr("data-original-title", auction.serverSeedHash);
        (<any> $elem.find(this.selectors.auctionServerHash)).tooltip('hide');
    }

    /**
     * Updates an existing auction GUI element (flashing the changed fields)
     * @param {JQuery<HTMLElement>} $elem
     */
    private updateAuctionElement($elem:JQuery<HTMLElement>, flash:boolean = true): void {

        let auction:any = $elem.data("auction");
        $elem.data("lastUpdateTime", Math.floor(new Date().getTime()/1000));
        this.updateRemainingTime($elem);
        $elem.find(this.selectors.auctionInstanceId).text(auction.type.toString() + "-" + auction.id.toString());
        $elem.find(this.selectors.auctionInstanceRemainingBids).text(auction.remaining_bid_count);

        $elem.find(this.selectors.auctionInstanceBidderOuter).addClass("d-none");
        $elem.find(this.selectors.auctionInstanceNoBidder).addClass("d-none");
        if (auction.last_bidder == Config.EOSTIME_CONTRACT) {
            $elem.find(this.selectors.auctionInstanceNoBidder).removeClass("d-none");
        } else {
            $elem.find(this.selectors.auctionInstanceBidderOuter).removeClass("d-none");
        }

        $elem.find(this.selectors.auctionInstanceBidder).text(auction.last_bidder);
        $elem.find(this.selectors.auctionInstanceBloksLink).attr("href", Config.ACCOUNT_INFO_LINK_PREFIX[this.eosNetwork] + auction.last_bidder);
        $elem.find(this.selectors.auctionInstancePrizePool).text(auction.prize_pool);
        $elem.find(this.selectors.auctionInstanceBidAmount).text(auction.bid_price);
        this.updateAuctionElementButtonState($elem, auction);
        this.updateBonusTimeTokens($elem);

        if (auction.clientSeed) {
            $elem.find(this.selectors.auctionClientSeed).removeClass("d-none").text(auction.clientSeed);
        } else {
            $elem.find(this.selectors.auctionClientSeed).addClass("d-none");
        }

        this.updateServerSeedHash($elem, auction);

        $elem.find(this.selectors.ribbonContainer).empty();
        if (auction.hasOwnProperty("html")) {
            $elem.find(this.selectors.ribbonContainer).html(auction.html);
        }

        let $minBidsMessage:JQuery<HTMLElement> = $elem.find(".auction-instance-min-bids-message");
        if ((auction.flags & 0x10) != 0x10) {
            $minBidsMessage.addClass("d-none");
        } else {
            let moreBids:number = auction.minBids  - (auction.init_bid_count - auction.remaining_bid_count);
            let message:string = (<any>$).t("minimum_bids", {count: moreBids});
            GUIManager.I18N["minimum_bids"] = {"elem": $minBidsMessage.find("div"), "params": {count: moreBids}};
            $minBidsMessage.removeClass("d-none");
            $minBidsMessage.find("div").html(message);
            (<any> $minBidsMessage).find('div').animateCss('pulse infinite');
        }

        if (flash) {
            // Flash our field elements
            let $elementsToFlash: JQuery<HTMLElement>[] = [
                $elem.find(this.selectors.auctionInstancePrizePool),
                $elem.find(this.selectors.auctionInstanceRemainingBids),
                $elem.find(this.selectors.formattedTimerString),
                $elem.find(this.selectors.auctionInstanceBidder)
            ];
            for (let $elemToFlash of $elementsToFlash) {
                $elemToFlash.removeClass("flash");
                setTimeout(() => {
                    for (let $elemToFlash of $elementsToFlash) {
                        $elemToFlash.addClass("flash");
                    }
                }, 10);
            }

            // Flash our border
            $elem.find(this.selectors.auctionInstanceInnerContainer).removeClass("flash-border");
            setTimeout(() => {
                $elem.find(this.selectors.auctionInstanceInnerContainer).addClass("flash-border");
            }, 10);
        }
    }

    private trimServerSeedHash(val:string, len:number = 10):string {
        let toRet: string = "";
        if (val) {
            for (let i: number = 0; i < len; i++) {
                toRet += val.charAt(i);
            }
            toRet += "...";
            for (let i: number = val.length - len; i < val.length; i++) {
                toRet += val.charAt(i);
            }
        }
        return toRet;
    }

    /**
     * Determines how many time tokens the current leader has earned
     *
     * @param auction
     * @param {number} blockTime
     */
    private timeTokenEarnedByLeader(auction:any, blockTime:number = null):number {
        if (blockTime === null) {
            blockTime = auction.block_time;
        }
        let lastBidTime:number = parseInt(moment(auction.last_bid_time + "+00:00").local().format("X"));
        if (lastBidTime > 0) {
            let secsInLead:number = blockTime - lastBidTime;
            let ttPerSec: number = auction.timecoins_per_second_bonus_x100k / 100000.0;
            let ttBonus: number = secsInLead * ttPerSec;
            ttBonus = parseFloat(ttBonus.toFixed(4));
            return ttBonus;
        } else {
            return 0;
        }
    }

    private hasHarpooned(auction:any):boolean {
        return (auction.harpoons.hasOwnProperty(this.accountInfo.account_name));
    }

    /**
     * Updates the bonus time token display
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private updateBonusTimeTokens($elem:JQuery<HTMLElement>, blockTime:number = null): void {
        if (!$elem.hasClass("d-none")) {
            let odometer: any = $elem.data("odometer");
            let auction = $elem.data("auction");
            let animate:boolean = $elem.data("animateOdometer") && !Config.LIMITED_MOBILE_UI;
            $elem.data("animateOdometer", true);
            if (odometer && auction) {
                if (auction.timecoins_per_second_bonus_x100k > 0) {
                    let ttBonus: number = this.timeTokenEarnedByLeader(auction, blockTime);
                    if (ttBonus >= 0) {
                        if (animate) {
                            odometer.update(ttBonus);
                        } else {
                            odometer.render(ttBonus);
                        }
                    }
                }
            }
        }
    };

    /**
     * Updates the remaining time on the specified auction GUI element
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private updateRemainingTime($elem:JQuery<HTMLElement>, auction:any = null): void {
        if (!auction) {
            auction = $elem.data("auction");
        }
        if (auction) {


            let clientTime:number = Math.floor(new Date().getTime()/1000);
            let lastUpdateTime:number = <number> $elem.data("lastUpdateTime");
            if (!lastUpdateTime) {
                lastUpdateTime = clientTime;
            }
            let secsSinceLastUpdate:number = clientTime - lastUpdateTime;
            let now: number = auction.block_time + secsSinceLastUpdate;
            let remainingSecs: number = auction.expires - now;
            if (remainingSecs < 0) {
                remainingSecs = 0;
            }

            // We are paused, waiting for bids so the remainingSecs is set
            // to the init_duration_secs of the auction
            if ((auction.flags & 0x10) == 0x10) {
                remainingSecs = auction.init_duration_secs;
            }

            let days: number = Math.floor(remainingSecs / 86400);
            if (!isNaN(days)) {
                if (days > 0) {
                    let fmtDays:string = days > 9 ? days.toString() : "0" + days.toString();
                    $elem.find(this.selectors.daysContainer).removeClass("d-none");
                    $elem.find(this.selectors.daysContainer).html(days.toString() + "<span style='font-size:75%' class='grey-text'>d </span>");
                    $elem.find(this.selectors.auctionInstanceDays).text(fmtDays);
                } else {
                    $elem.find(this.selectors.daysContainer).addClass("d-none");
                }
            } else {
                $elem.find(this.selectors.daysContainer).addClass("d-none");
            }

            remainingSecs -= 86400 * days;
            let hours: number = Math.floor(remainingSecs / 3600);
            remainingSecs -= 3600 * hours;
            let minutes: number = Math.floor(remainingSecs / 60);
            remainingSecs -= 60 * minutes;
            remainingSecs = Math.floor(remainingSecs);

            $elem.find(this.selectors.formattedTimerString).html("");
            if (!isNaN(hours) && !isNaN(minutes) && !isNaN(remainingSecs)) {
                let hoursStr: string = hours.toString().length == 1 ? "0" + hours.toString() : hours.toString();
                let minsStr: string = minutes.toString().length == 1 ? "0" + minutes.toString() : minutes.toString();
                let secsStr: string = remainingSecs.toString().length == 1 ? "0" + remainingSecs.toString() : remainingSecs.toString();
                let formatedRemaining: string = hoursStr + "<span style='font-size:75%' class='grey-text'>h </span>" + minsStr + "<span style='font-size:75%' class='grey-text'>m </span>" + secsStr + "<span style='font-size:75%' class='grey-text'>s</span>";

                $elem.find(this.selectors.formattedTimerString).html(formatedRemaining);
                $elem.find(this.selectors.auctionInstanceHours).text(hoursStr);
                $elem.find(this.selectors.auctionInstanceMinutes).text(minsStr);
                $elem.find(this.selectors.auctionInstanceSeconds).text(secsStr);
            }
        }
    };

    // ========================================================================
    // BLOCKCHAIN API METHODS
    // ========================================================================

    /**
     * Requests the harpoon signature from the server.
     *
     * @param {JQuery<HTMLElement>} $auctionElement
     * @returns {Promise<any>}
     */
    private eosHarpoon($auctionElement:JQuery<HTMLElement>):Promise<any> {
        return new Promise<any>((resolve, reject) => {
            try {
                if (this.accountInfo && this.accountInfo.acceptedTerms) {
                    let ha: HarpoonAnimation = <HarpoonAnimation> $auctionElement.data("harpoonAnimation");
                    if (!ha.isActive()) {
                        ha.start();
                        let auction: any = $auctionElement.data("auction");
                        this.socketMessage.ctsGetHarpoonSignature(auction.id);
                    }
                } else {
                    let evt:CustomEvent = new CustomEvent("termsAndConditions", {"detail": null});
                    document.dispatchEvent(evt);
                }
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Harpoons a specific auction.
     *
     * @param {JQuery<HTMLElement>} $auctionElement
     * @param {string} accountName
     * @param {string} signature
     * @param {number} accountId
     * @returns {Promise<any>}
     * @private
     */
    public eosHarpoon_($auctionElement:JQuery<HTMLElement>, accountName:string, signature:string, accountId:number):Promise<any> {

        if (this.eos) {
            return this.eos.transaction({
                actions: [
                    {
                        account: 'eostimecontr',
                        name: 'rzharpoon',
                        authorization: [{
                            actor: accountName,
                            permission: 'active',
                        }],
                        data: {
                            sender: accountName,
                            signature_str: signature,
                            redzone_id: accountId
                        }
                    }
                ]
            }, {
                blocksBehind: 3,
                expireSeconds: 30,
            });
        } else {
            return Promise.reject("No eos object in eosHarpoon_");
        }
    }

    /**
     * Places a bid on an auction
     * @param {JQuery<HTMLElement>} $auctionElement
     * @returns {Promise<any>}
     */
    private eosBid($auctionElement:JQuery<HTMLElement>):Promise<any> {
        return new Promise<any>((resolve, reject) => {
            try {
                if (this.accountInfo && this.accountInfo.acceptedTerms) {
                    let auction: any = $auctionElement.data("auction");
                    this.socketMessage.ctsGetBidSignature(auction.type, auction.bid_price, this.clientSeed);

                    // Update the clientSeed if we are set to autorandomize
                    if (this.autoRandomize) {
                        this.clientSeed = Math.floor(Math.random() * 100000);
                        localStorage.setItem(Config.LOCAL_STORAGE_KEY_CLIENT_SEED, this.clientSeed.toString());
                    }
                } else {
                    let evt:CustomEvent = new CustomEvent("termsAndConditions", {"detail": null});
                    document.dispatchEvent(evt);
                }
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Places a bid on the blockchain
     * @param $auctionElement
     * @param signature
     */
    private _eosBid($auctionElement:JQuery<HTMLElement>, signature:string):Promise<any> {
        return new Promise<any>(async (resolve, reject) => {
            let busy:boolean = !$auctionElement.find(this.selectors.auctionInstanceBusy).hasClass("d-none");
            if (this.eos && !busy) {
                if (signature == "HARPOON") {
                    $auctionElement.find(this.selectors.auctionInstanceBusy).addClass("d-none");
                    let title: string;
                    let message: string;
                    if (this.currentLanguage == "chinese") {
                        title = "出价被拒绝";
                        message = "一旦您进行了拍卖，您就无法参与拍卖。";
                    } else {
                        title = "Bid Rejected";
                        message = "You cannot bid in an auction once you have harpooned it.";
                    }
                    (<any> $).notify({
                        title: title,
                        message: message
                    }, {
                        type: "info",
                        allow_dismiss: false,
                        delay: 4000,
                        placement: {
                            from: "top",
                            align: "center"
                        },
                        template: '<div data-notify="container" class="col-xs-11 col-sm-3 alert alert-{0}" role="alert">' +
                        '<button type="button" aria-hidden="true" class="close" data-notify="dismiss">×</button>' +
                        '<span data-notify="icon"></span> ' +
                        '<div data-notify="title"><i class="fas fa-gavel"></i>&nbsp;&nbsp;<strong>{1}</strong></div> ' +
                        '<div><hr /></div>' +
                        '<div data-notify="message" class="pb-1">{2}</div>' +
                        '<div class="progress" data-notify="progressbar">' +
                        '<div class="progress-bar progress-bar-{0}" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>' +
                        '</div>' +
                        '<a href="{3}" target="{4}" data-notify="url"></a>' +
                        '</div>'
                    });
                } else {
                    let auction: any = $auctionElement.data("auction");
                    const options = {authorization: [`${this.account.name}@${this.account.authority}`]};
                    let assetAndQuantity: string = auction.bid_price + " EOS";

                    let memo: string = null;
                    if (signature) {
                        memo = "RZBID-" + signature + "-" + auction.id;
                    } else {
                        memo = "RZBID-" + auction.id;
                    }

                    if (this.referrer) {
                        memo += "-" + this.referrer;
                    }

                    try {
                        $auctionElement.find(this.selectors.auctionInstanceBusy).removeClass("d-none");
                        this.eos.transfer(this.account.name, Config.eostimeContract, assetAndQuantity, memo, options).then((result) => {
                            console.log(result);
                        }).catch(err => {
                            $auctionElement.find(this.selectors.auctionInstanceBusy).addClass("d-none");
                            try {
                                err = JSON.parse(err);
                            } catch (err) { }
                            console.log(err);

                            // Notify user if he was outbid
                            let errorDetails: any[] = Config.safeProperty(err, ["error.details"], null);
                            if (errorDetails) {
                                let userErrorMessage: string = null;
                                for (let errorDetail of errorDetails) {
                                    let em: string = Config.safeProperty(errorDetail, ["message"], null);
                                    em = em.toLowerCase();
                                    if (em.indexOf("incorrect amount sent") >= 0) {
                                        switch (this.currentLanguage) {
                                            case 'english':
                                                userErrorMessage = "Your bid came in after " + auction.last_bidder + ".";
                                                break;
                                            case 'chinese':
                                                userErrorMessage = "你的出价在之后出现了 " + auction.last_bidder + ".";
                                                break;
                                        }
                                        break;
                                    }
                                    if ((em.indexOf("redzone doesn't exist") >= 0) || (em.indexOf("redzone has ended") >= 0)) {
                                        switch (this.currentLanguage) {
                                            case 'english':
                                                userErrorMessage = "The auction ended before your bid was received.";
                                                break;
                                            case 'chinese':
                                                userErrorMessage = "拍卖会在收到您的出价之前结束";
                                                break;
                                        }
                                        break;
                                    }
                                    if (em.indexOf("error expected key different than recovered key")) {
                                        // User has been banned, but we don't really need to tell him that
                                        switch (this.currentLanguage) {
                                            case 'english':
                                                userErrorMessage = "Your bid resulted in an unexpected error. Please try again later.";
                                                break;
                                            case 'chinese':
                                                userErrorMessage = "您的出价导致意外错误。请稍后再试。";
                                                break;
                                        }
                                        break;
                                    }
                                }
                                if (userErrorMessage) {
                                    let title: string = "Bid Rejected";
                                    if (this.currentLanguage == "chinese") {
                                        title = "出价被拒绝";
                                    }
                                    (<any> $).notify({
                                        title: title,
                                        message: userErrorMessage
                                    }, {
                                        type: "info",
                                        allow_dismiss: false,
                                        delay: 4000,
                                        placement: {
                                            from: "top",
                                            align: "center"
                                        },
                                        template: '<div data-notify="container" class="col-xs-11 col-sm-3 alert alert-{0}" role="alert">' +
                                        '<button type="button" aria-hidden="true" class="close" data-notify="dismiss">×</button>' +
                                        '<span data-notify="icon"></span> ' +
                                        '<div data-notify="title"><i class="fas fa-gavel"></i>&nbsp;&nbsp;<strong>{1}</strong></div> ' +
                                        '<div><hr /></div>' +
                                        '<div data-notify="message" class="pb-1">{2}</div>' +
                                        '<div class="progress" data-notify="progressbar">' +
                                        '<div class="progress-bar progress-bar-{0}" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>' +
                                        '</div>' +
                                        '<a href="{3}" target="{4}" data-notify="url"></a>' +
                                        '</div>'
                                    });
                                }
                            }

                            console.log(err);

                            // Indicate failure to user with an animation on the bid button
                            let $bidButton: JQuery<HTMLElement> = $auctionElement.find(".auction-instance-bid-button");
                            (<any> $bidButton).animateCss('headShake');
                            $bidButton.blur();
                        });
                    } catch (err) {
                        console.log("Caught error");
                        console.log(err);
                    }
                }

            } else {
                reject(new Error("No eos object available or busy"));
            }
        });
    }
}