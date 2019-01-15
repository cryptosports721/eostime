import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";


@Entity("bid",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("bidId_UNIQUE",["bidId",],{unique:true})
@Index("amount_idx",["amount",])
@Index("accountName",["accountName",])
@Index("auctionId",["auctionId",])
@Index("creationDatetime_idx",["creationDatetime",])
export class bid extends BaseEntity {

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
        nullable:false,
        unique: true,
        name:"bidId"
        })
    bidId:number;
        

    @Column("int",{ 
        nullable:true,
        name:"auctionId"
        })
    auctionId:number | null;
        

    @Column("varchar",{ 
        nullable:false,
        length:12,
        name:"accountName"
        })
    accountName:string;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"amount"
        })
    amount:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:16,
        default: () => "'EOS'",
        name:"currency"
        })
    currency:string;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"housePortion"
        })
    housePortion:number | null;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"referrerPortion"
        })
    referrerPortion:number | null;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"bidderTimeTokens"
        })
    bidderTimeTokens:number | null;
        
}
