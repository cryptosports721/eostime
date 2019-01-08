import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";
import {auctions} from "./auctions";
import {bid} from "./bid";
import {ipAddress} from "./ipAddress";
import {payment} from "./payment";


@Entity("user",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("accountName_UNIQUE",["accountName",],{unique:true})
@Index("creationDatetime_IDX",["creationDatetime",])
@Index("lastConnectedDatetime_IDX",["lastConnectedDatetime",])
@Index("lastFaucetDatetime_IDX",["lastFaucetDatetime",])
@Index("referrer_IDX",["referrer",])
@Index("acceptedTerms_idx",["acceptedTerms",])
export class user extends BaseEntity {

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
        

    @Column("datetime",{ 
        nullable:true,
        name:"lastConnectedDatetime"
        })
    lastConnectedDatetime:Date | null;
        

    @Column("datetime",{ 
        nullable:true,
        name:"lastFaucetDatetime"
        })
    lastFaucetDatetime:Date | null;
        

    @Column("varchar",{ 
        nullable:false,
        unique: true,
        length:12,
        name:"accountName"
        })
    accountName:string;
        

    @Column("enum",{ 
        nullable:false,
        default: () => "'false'",
        enum:["true","false"],
        name:"acceptedTerms"
        })
    acceptedTerms:string;
        

    @Column("int",{ 
        nullable:false,
        default: () => "'0'",
        name:"connectionCount"
        })
    connectionCount:number;
        

    @Column("double",{ 
        nullable:false,
        default: () => "'0'",
        precision:22,
        name:"eosBalance"
        })
    eosBalance:number;
        

    @Column("double",{ 
        nullable:false,
        default: () => "'0'",
        precision:22,
        name:"timeBalance"
        })
    timeBalance:number;
        

    @Column("varchar",{ 
        nullable:true,
        length:12,
        name:"referrer"
        })
    referrer:string | null;
        

   
    @OneToMany(type=>auctions, auctions=>auctions.user_,{ onDelete: 'NO ACTION' ,onUpdate: 'NO ACTION' })
    auctionss:auctions[];
    

   
    @OneToMany(type=>bid, bid=>bid.user_,{ onDelete: 'NO ACTION' ,onUpdate: 'NO ACTION' })
    bs:bid[];
    

   
    @OneToMany(type=>ipAddress, ipAddress=>ipAddress.user_,{ onDelete: 'NO ACTION' ,onUpdate: 'NO ACTION' })
    ipAddresss:ipAddress[];
    

   
    @OneToMany(type=>payment, payment=>payment.user_,{ onDelete: 'NO ACTION' ,onUpdate: 'NO ACTION' })
    payments:payment[];
    
}
