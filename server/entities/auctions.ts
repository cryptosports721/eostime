import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";
import {bid} from "./bid";
import {user} from "./user";
import {auctionType} from "./auctionType";


@Entity("auctions",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("auctionId_UNIQUE",["auctionId",],{unique:true})
@Index("fk_auctions_user1_idx",["user_",])
@Index("lastBidderAccount_idx",["lastBidderAccount",])
@Index("creationDatetime_idx",["creationDatetime",])
@Index("prizePool_idx",["prizePool",])
@Index("fk_auctions_bid1_idx",["bid_",])
@Index("transactionId_idx",["transactionId",])
@Index("blockNumber_idx",["blockNumber",])
@Index("fk_auctions_auctionType1_idx",["auctionType_",])
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
        unique: true,
        name:"auctionId"
        })
    auctionId:number | null;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"prizePool"
        })
    prizePool:number;
        

    @Column("datetime",{ 
        nullable:false,
        name:"endedDatetime"
        })
    endedDatetime:Date;
        

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
        

   
    @ManyToOne(type=>bid, bid=>bid.auctionss,{  nullable:false,onDelete: 'NO ACTION',onUpdate: 'NO ACTION' })
    @JoinColumn({ name:'bid_id'})
    bid_:bid | null;


   
    @ManyToOne(type=>user, user=>user.auctionss,{  nullable:false,onDelete: 'NO ACTION',onUpdate: 'NO ACTION' })
    @JoinColumn({ name:'user_id'})
    user_:user | null;


   
    @ManyToOne(type=>auctionType, auctionType=>auctionType.auctionss,{  nullable:false,onDelete: 'NO ACTION',onUpdate: 'NO ACTION' })
    @JoinColumn({ name:'auctionType_id'})
    auctionType_:auctionType | null;

}
