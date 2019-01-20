import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";
import {harpoon} from "./harpoon";


@Entity("auctions",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("auctionId_UNIQUE",["auctionId",],{unique:true})
@Index("lastBidderAccount_idx",["lastBidderAccount",])
@Index("creationDatetime_idx",["creationDatetime",])
@Index("prizePool_idx",["prizePool",])
@Index("transactionId_idx",["transactionId",])
@Index("blockNumber_idx",["blockNumber",])
@Index("auctionType_idx",["auctionType",])
@Index("endingBidId_idx",["endingBidId",])
@Index("bonuseTimeTokens_idx",["bonusTimeTokens",])
@Index("fk_auctions_harpoon1_idx",["harpoon_",])
export class auctions extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("datetime",{ 
        nullable:false,
        name:"creationDatetime"
        })
    creationDatetime:Date;
        

    @Column("int",{ 
        nullable:true,
        name:"auctionType"
        })
    auctionType:number | null;
        

    @Column("int",{ 
        nullable:false,
        unique: true,
        name:"auctionId"
        })
    auctionId:number;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"prizePool"
        })
    prizePool:number | null;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"bonusTimeTokens"
        })
    bonusTimeTokens:number | null;
        

    @Column("datetime",{ 
        nullable:true,
        name:"endedDatetime"
        })
    endedDatetime:Date | null;
        

    @Column("int",{ 
        nullable:true,
        name:"endingBidId"
        })
    endingBidId:number | null;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"endingBidPrice"
        })
    endingBidPrice:number | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:12,
        name:"lastBidderAccount"
        })
    lastBidderAccount:string | null;
        

    @Column("int",{ 
        nullable:false,
        default: () => "'0'",
        name:"flags"
        })
    flags:number;
        

    @Column("int",{ 
        nullable:true,
        name:"blockNumber"
        })
    blockNumber:number | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:128,
        name:"transactionId"
        })
    transactionId:string | null;
        

   
    @ManyToOne(type=>harpoon, harpoon=>harpoon.auctionss,{ onDelete: 'NO ACTION',onUpdate: 'NO ACTION' })
    @JoinColumn({ name:'harpoon_id'})
    harpoon_:harpoon | null;

}
