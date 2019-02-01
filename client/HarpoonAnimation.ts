import {ViewStateObserver} from "./ViewStateObserver";

export class HarpoonAnimation {

    private startTime:number = 0;
    private deferredStop:boolean = false;
    private deferredMissPayload:any = null;
    private rollAnimationTimer:any = null;
    private $outerContainer:JQuery<HTMLElement>;
    private active:boolean = false;
    private animationCompleteCallback:() => void;

    constructor($outerContainer:JQuery<HTMLElement>, animationCompleteCallback:() => void) {

        this.$outerContainer = $outerContainer;
        this.animationCompleteCallback = animationCompleteCallback;
        this.$outerContainer.find(".close-icon").on("click", (event) => {
            this.reset();
        });

    }

    public isActive():boolean {
        return this.active;
    }

    public start():void {
        if (!this.active) {
            this.$outerContainer.removeClass("d-none");
            this.$outerContainer.find(".number-animation").removeClass("d-none");
            if (!this.rollAnimationTimer) {
                this.rollAnimationTimer = setInterval(() => {
                    let now:number = new Date().getTime();
                    var randomValue = Math.floor(Math.random() * 4294967296);
                    this.$outerContainer.find(".harpoon-roll").text(randomValue.toString());
                    if (this.deferredStop) {
                        let duration:number = now - this.startTime;
                        if (duration > 2500) {
                            this.stop();
                        }
                    } else if (this.deferredMissPayload) {
                        let duration:number = now - this.startTime;
                        if (duration > 2500) {
                            this.miss(this.deferredMissPayload);
                        }
                    }
                }, 100);
            }
            this.startTime = new Date().getTime();
            this.active = true;
        }
    }

    public isAnimating():boolean {
        return (this.rollAnimationTimer !== null);
    }

    public miss(payload:any):void {
        if (this.active) {
            let now: number = new Date().getTime();
            let duration: number = now - this.startTime;
            if (duration > 2500) {
                if (this.rollAnimationTimer) {
                    clearInterval(this.rollAnimationTimer);
                    this.rollAnimationTimer = null;
                    if (this.animationCompleteCallback) {
                        this.animationCompleteCallback();
                    }
                }
                this.$outerContainer.find(".harpoon-info-server-seed-hash").text(payload.serverSeedHash);
                this.$outerContainer.find(".harpoon-info-server-seed").text(payload.serverSeed);
                this.$outerContainer.find(".harpoon-info-client-seed").text(payload.clientSeed);
                this.$outerContainer.find(".harpoon-info-odds").text((100*payload.odds).toFixed(2) + "%");
                this.$outerContainer.find(".harpoon-info-harpoon-max").text(payload.harpoonMax);
                this.$outerContainer.find(".harpoon-info-result").text(payload.result);

                this.$outerContainer.find(".number-animation").addClass("d-none");
                this.$outerContainer.find(".harpoon-miss").removeClass("d-none");

            } else {
                this.deferredMissPayload = payload;
            }
        }
    }

    public stop(): void {
        if (this.active) {
            let now:number = new Date().getTime();
            let duration:number = now - this.startTime;
            if (duration > 2500) {
                this.$outerContainer.addClass("d-none");
                this.$outerContainer.find(".number-animation").addClass("d-none");
                if (this.rollAnimationTimer) {
                    clearInterval(this.rollAnimationTimer);
                    this.rollAnimationTimer = null;
                    if (this.animationCompleteCallback) {
                        this.animationCompleteCallback();
                    }
                }
                this.active = false;
                this.startTime = 0;
                this.deferredStop = false;
            } else {
                this.deferredStop = true;
            }
        }
    }

    private reset():void {
        this.active = false;
        this.startTime = 0;
        this.deferredStop = false;
        this.deferredMissPayload = null;
        if (this.rollAnimationTimer) {
            clearInterval(this.rollAnimationTimer);
            this.rollAnimationTimer = null;
        }
        this.$outerContainer.addClass("d-none");
        this.$outerContainer.find(".number-animation").addClass("d-none");
        this.$outerContainer.find(".harpoon-miss").addClass("d-none");
    }
}