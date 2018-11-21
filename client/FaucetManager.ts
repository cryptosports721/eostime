import {ViewStateObserver} from "./ViewStateObserver";
import {SocketMessage} from "../server/SocketMessage";
import {GUIManager} from "./GUIManager";
import {Config} from "./Config";

export class FaucetManager extends ViewStateObserver {

    private socketMessage:SocketMessage = null;
    private guiManager: GUIManager;
    private nextDrawTime:number = null;
    private drawTimer:any = null;
    private rollAnimationTimer:any = null;
    private safetyTimer:any = null;

    constructor(socketMessage:SocketMessage, guiManager:GUIManager) {
        super();
        this.socketMessage = socketMessage;
        this.guiManager = guiManager;
        this.attachSocketListeners();
    }

    /**
     * Listen to UI
     */
    protected attachGUIHandlers():void {
        super.attachGUIHandlers();

        // User has logged in so we can now retrieve our faucet info from the server
        $(document).on("userLogIn", (accountInfo:any) => {
            this.socketMessage.ctsGetFaucetInfo();
        });

        $(document).on("faucetDraw", () => {
            this.socketMessage.ctsFaucetDraw();
        })

        $(document).on("updateTimeTillDraw", function(event) {
            var timeTillDraw = <any> event.detail;

            // timeTillDraw is an object that looks like this:
            //
            // {hours: "01", minutes: "05", seconds: "09"}
            //
            // This object should update your time till next draw UI element. You will only
            // receive these while the user is eligible to draw (or just prior to a
            // canDrawNow => false message);
            $(".next-draw-hours").text(timeTillDraw.hours);
            $(".next-draw-minutes").text(timeTillDraw.minutes);
            $(".next-draw-seconds").text(timeTillDraw.seconds);
        });

        $(document).on("canDrawNow", function(event) {
            var canDraw = event.detail;

            // canDraw is a boolean that indicates whether or not the user
            // can currently draw or not. Should update your UI accordly
            if (canDraw) {
                $(".cannot-draw-now").addClass("d-none");
                $(".can-draw-now").removeClass("d-none");
            } else {
                $(".cannot-draw-now").removeClass("d-none");
                $(".can-draw-now").addClass("d-none");
            }
        });

        // Do this and we will attempt to draw.
        $(".draw-button").on("click", (event) => {

            if (!this.rollAnimationTimer) {

                $(".draw-button").addClass("disabled");
                $(".faucet-roll-animation").removeClass("d-none");
                $(".faucet-award").addClass("d-none");
                $(".faucet-ui-blocker").removeClass("d-none");

                this.rollAnimationTimer = setInterval(function() {
                    var randomValue = Math.floor(Math.random()*10000);
                    $(".faucet-roll-animation").text(randomValue.toString());
                }, 100);

                // Let the animation play for a couple of seconds just for kicks,
                setTimeout(function() {
                    var evt = new CustomEvent("faucetDraw", {});
                    document.dispatchEvent(evt);
                }, 1500);

                /**
                 * Handles case where the draw needs to be re-enabled because we
                 * never got a response from the server
                 * @type {number}
                 */
                this.safetyTimer = setTimeout(() => {
                    this.safetyTimer = null;
                    $(".faucet-ui-blocker").addClass("d-none");
                    $(".draw-button").removeClass("disabled");
                    $(".draw-button").blur();

                    if (this.rollAnimationTimer) {
                        clearInterval(this.rollAnimationTimer);
                        this.rollAnimationTimer = null;
                    }

                    (<any> $(".draw-button")).animateCss("headShake");
                }, 5000);
            }
        });

        $(document).on("faucetAward", (event) => {
            var award = <any> event.detail;

            if (this.safetyTimer) {
                clearTimeout(this.safetyTimer);
                this.safetyTimer = null;
            }
            $(".draw-button").blur();

            // awardAmount is a float indicating the EOS awarded by the faucet. Do
            // whatever you want (animation, set a value someplace, or nothing). The
            // user's EOS balance would have already been updated.
            //
            // A value of 0 for award.eosAward and award.randomDraw indicates that
            // the request was made before the waiting period expired.
            //
            if (this.rollAnimationTimer) {
                clearInterval(this.rollAnimationTimer);
                this.rollAnimationTimer = null;
            }

            $(".next-draw-hours").text(award.nextDraw.hours);
            $(".next-draw-minutes").text(award.nextDraw.minutes);
            $(".next-draw-seconds").text(award.nextDraw.seconds);

            if (award.eosAward === 0) {
                // No No, can't get a reward too quickly! (should not happen)
                $(".draw-button").removeClass("disabled");
                $(".faucet-ui-blocker").addClass("d-none");
                (<any> $(".draw-button")).animateCss("headShake");
            } else {
                $(".faucet-roll-animation").addClass("d-none");
                $(".faucet-award").find(".faucet-roll").text(award.randomDraw);
                $(".faucet-award").find(".faucet-award").text(award.eosAward);
                $(".faucet-award").removeClass("d-none");
                (<any> $(".faucet-award")).animateCss("bounceIn", () => {
                    setTimeout(() => {
                        $(".draw-button").removeClass("disabled");
                        (<any> $(".faucet-ui-blocker")).animateCss("fadeOut", () => {
                            $(".faucet-ui-blocker").addClass("d-none");
                        });
                    }, 2000);
                });
            }
        });
    }

    /**
     * Attach our socket listeners
     */
    private attachSocketListeners():void {

        /**
         * Sent by the server in response to a request for the
         */
        this.socketMessage.getSocket().on(SocketMessage.STC_FAUCET_INFO, (data:any) => {
            data = JSON.parse(data);
            let secsTillDraw:number = Config.safeProperty(data, ["nextDrawSecs"], null);
            if (secsTillDraw !== null) {
                let evt:CustomEvent;
                if (secsTillDraw === 0) {
                    // We can draw right now!
                    evt = new CustomEvent("canDrawNow", {"detail": true});
                } else {
                    // Got to wait!
                    this.startNextTickTimer(secsTillDraw);
                    evt = new CustomEvent("canDrawNow", {"detail": false});
                }
                document.dispatchEvent(evt);
            } else {
                console.log("Unexpected situation: Missing nextDrawSecs value");
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_FAUCET_AWARD, (data:any) => {
            data = JSON.parse(data);
            let eosAward:string = Config.safeProperty(data, ["eosAward"], null);
            let randomDraw:number = Config.safeProperty(data, ["randomDraw"], 0);
            let remainingSecs:number = Config.safeProperty(data, ["nextDrawSecs"], null);
            if (remainingSecs) {
                let remainingSecsObj:any = this.synthesizeTimeObj(remainingSecs);

                if (eosAward) {
                    let evt: CustomEvent = new CustomEvent("faucetAward", {"detail": {eosAward: eosAward, randomDraw: randomDraw, nextDraw: remainingSecsObj}});
                    document.dispatchEvent(evt);

                    // Update our EOS balance in 3 seconds
                    setTimeout(() => {
                        let evt:CustomEvent = new CustomEvent("updateCoinBalances", {"detail": {}});
                        document.dispatchEvent(evt);
                    }, 3000);

                } else {
                    let evt: CustomEvent = new CustomEvent("faucetAward", {"detail": {eosAward: 0, randomDraw: randomDraw, nextDraw: remainingSecsObj}});
                    document.dispatchEvent(evt);
                }

                // Cannot draw again for a while
                let evt: CustomEvent = new CustomEvent("canDrawNow", {"detail": false});
                document.dispatchEvent(evt);
                this.startNextTickTimer(remainingSecs);

            } else {
                console.log("Unexpected situation: Missing nextDrawSecs value.");
            }
        });
    }

    /**
     * Starts our timer to update the next draw time
     * @param {number} secsTillDraw
     */
    private startNextTickTimer(secsTillDraw:number):void {
        if (this.drawTimer === null) {
            // Start our draw timer
            this.nextDrawTime = Math.floor(new Date().getTime() / 1000) + secsTillDraw;
            this.nextTick();
            this.drawTimer = setInterval(() => {
                this.nextTick();
            }, 1000);
        }
    }

    /**
     * While waiting for next draw time, we hit this in a 1 second timer interval
     */
    private nextTick():void {
        let remainingSecs:number = this.nextDrawTime - Math.floor(new Date().getTime()/1000);
        if (remainingSecs > 0) {let obj:any = this.synthesizeTimeObj(remainingSecs);
            let evt:CustomEvent = new CustomEvent("updateTimeTillDraw", {"detail": obj});
            document.dispatchEvent(evt);
        } else {
            // We are done and ready for the next draw
            clearInterval(this.drawTimer);
            let evt:CustomEvent = new CustomEvent("canDrawNow", {"detail": true});
            document.dispatchEvent(evt);
            this.nextDrawTime = null;
            this.drawTimer = null;
        }
    }

    /**
     * Creates a standard time object
     * @param {number} remainingSecs
     * @returns {any}
     */
    private synthesizeTimeObj(remainingSecs:number):any {
        let days: number = Math.floor(remainingSecs / 86400);
        remainingSecs -= 86400 * days;
        let hours: number = Math.floor(remainingSecs / 3600);
        remainingSecs -= 3600 * hours;
        let minutes: number = Math.floor(remainingSecs / 60);
        remainingSecs -= 60 * minutes;
        remainingSecs = Math.floor(remainingSecs);
        let hoursStr: string = hours.toString().length == 1 ? "0" + hours.toString() : hours.toString();
        let minsStr: string = minutes.toString().length == 1 ? "0" + minutes.toString() : minutes.toString();
        let secsStr: string = remainingSecs.toString().length == 1 ? "0" + remainingSecs.toString() : remainingSecs.toString();

        return{nextDrawSecs: remainingSecs, days: days.toString(), hours: hoursStr, minutes: minsStr, seconds: secsStr};

    }

}