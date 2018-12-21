import {SocketMessage} from "../server/SocketMessage";
import {GUIManager} from "./GUIManager";
import {ViewStateObserver} from "./ViewStateObserver";
import {Config} from "./Config";

export class DividendManager extends ViewStateObserver {

    private eos:any = null;
    private guiManager:GUIManager = null;
    private socketMessage:SocketMessage = null;
    private timeTokenSupply:number = 0.0;
    private timeTokenBalance:number = 0.0;
    private dividendBalance:number = 0.0;

    private timer:any = null;
    private nextPayout:number = 0;
    private dividendPool:number = 0;

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

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
            this.updatePage();
        });

        // We now have a socket connection
        $(document).on("initializeGameGUI", (event) => {
            this.socketMessage.ctsGetDividendInfo();
        });

        $(".refresh").on("click", (event) => {
            this.updatePage(true);
        });

        $(document).on("updateEOSBalance", (event) => {
            let balance = event.detail;
        });

        $(document).on("updateTIMEBalance", (event) => {
            let balance:any = event.detail;
            this.timeTokenBalance = parseFloat(balance);
            this.updatePage(false);
        });
    }

    // ========================================================================
    // PROTECTED METHODS
    // ========================================================================

    protected setLoggedInView(account:any, accountInfo:any):void {
        super.setLoggedInView(account, accountInfo);
        this.eos.getCurrencyBalance(Config.TIME_TOKEN_CONTRACT, this.account.name, Config.TIME_TOKEN_SYMBOL).then((result:string[]) => {
            let coinBalance = result.find(currency => currency.indexOf(Config.TIME_TOKEN_SYMBOL) >= 0);
            if (coinBalance) {
                this.timeTokenBalance = parseFloat(coinBalance);
            }
            this.updateDividendFields(false);
        });
    }

    protected setLoggedOutView():void {
        super.setLoggedOutView();
        this.timeTokenBalance = 0.0;
        this.updateDividendFields(false);
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private updatePage(animate:boolean = false):void {
        if (this.eos) {
            this.eos.getTableRows(
                {
                    code: Config.TIME_TOKEN_CONTRACT,
                    scope: Config.TIME_TOKEN_SYMBOL,
                    table: "stat",
                    json: true,
                }
            ).then((timeTokenTable:any) => {
                this.timeTokenSupply = parseFloat(timeTokenTable.rows[0].supply) - 12500000000;
                return this.eos.getAccount(Config.eostimeDividendContract);
            }).then((result:any) => {
                this.dividendBalance = parseFloat(result.core_liquid_balance);
                this.updateDividendFields(animate);
            });
        }
    }

    private updateDividendFields(animate:boolean):void {
        $(".time-token-balance").text(this.timeTokenBalance.toFixed(4));
        $(".time-tokens-issued").text(this.timeTokenSupply.toFixed(4));
        $(".dividend-pool").text(this.dividendBalance.toFixed(4));

        let expectedPayout:number = this.dividendBalance * this.timeTokenBalance / this.timeTokenSupply;
        if (isNaN(expectedPayout)) {
            $(".expected-payout").addClass("d-none");
        } else {
            $(".expected-payout").text(expectedPayout.toFixed(4));
            $(".expected-payout").removeClass("d-none");
            if (animate) {
                (<any> $(".expected-payout")).animateCss("bounceIn");
            }
        }

        let expPer100:number = this.dividendBalance * 10000/this.timeTokenSupply;
        if (isNaN(expPer100)) {
            $(".expected-payout-per-100K").addClass("d-none");
        } else {
            $(".expected-payout-per-100K").text(expPer100.toFixed(4));
            $(".expected-payout-per-100K").removeClass("d-none");
            if (animate) {
                (<any> $(".expected-payout-per-100K")).animateCss("bounceIn");
            }
        }

        if (animate) {
            (<any> $(".dividend-pool")).animateCss("bounceIn");
        }
    }

    /**
     * Attach our socket listeners
     */
    private attachSocketListeners():void {
        this.socketMessage.getSocket().on(SocketMessage.STC_DIVIDEND_INFO, (data:any) => {
            data = JSON.parse(data);
            this.nextPayout = data.nextPayout;
            this.dividendPool = data.dividendPool;
            if (!this.timer) {
                this.updateCountdownTimer();
                $(".count_down").removeClass("d-none");
                this.timer = setTimeout(this.updateCountdownTimer.bind(this), 1000);
                this.updatePage(true);
            }
        });
    }

    /**
     * Updates the timer on our page (called on a timer)
     */
    private updateCountdownTimer():void {
        let timeObj:any;
        let remainingSecs:number = this.nextPayout - Math.floor(new Date().getTime()/1000);
        if (remainingSecs > 0) {
            timeObj = this.synthesizeTimeObj(remainingSecs);
            this.timer = setTimeout(this.updateCountdownTimer.bind(this), 1000);
        } else {
            this.timer = null;
            timeObj = {
                days: "0", hours: "00", minutes: "00", seconds: "00"
            }

            // Update our dividend page in 10 seconds
            // setTimeout(() => {
            //     this.socketMessage.ctsGetDividendInfo();
            // }, 10000);
        }
        $("#hours").text(timeObj.hours);
        $("#minutes").text(timeObj.minutes);
        $("#seconds").text(timeObj.seconds);
        if (timeObj.days != "0") {
            $("#days").find("span").text(timeObj.days);
            $("#days").removeClass("d-none");
        } else {
            $("#days").addClass("d-none");
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

        return {days: days.toString(), hours: hoursStr, minutes: minsStr, seconds: secsStr};
    }
}