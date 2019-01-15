import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";


@Entity("eostimetoken",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("hash_UNIQUE",["hash",],{unique:true})
@Index("timestamp_idx",["timestamp",])
@Index("transactionId_idx",["transactionId",])
@Index("blockNumber_idx",["blockNumber",])
@Index("name_idx",["name",])
@Index("from_idx",["from",])
@Index("to_idx",["to",])
@Index("quantity_idx",["quantity",])
@Index("account_idx",["account",])
@Index("auctionType_idx",["auctionType",])
@Index("auctionId_idx",["auctionId",])
@Index("bidId_idx",["bidId",])
export class eostimetoken extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("datetime",{ 
        nullable:false,
        name:"timestamp"
        })
    timestamp:Date;
        

    @Column("varchar",{ 
        nullable:true,
        length:45,
        name:"name"
        })
    name:string | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:64,
        name:"transactionId"
        })
    transactionId:string | null;
        

    @Column("int",{ 
        nullable:true,
        name:"blockNumber"
        })
    blockNumber:number | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:12,
        name:"from"
        })
    from:string | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:12,
        name:"to"
        })
    to:string | null;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"quantity"
        })
    quantity:number | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:45,
        name:"currency"
        })
    currency:string | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:256,
        name:"memo"
        })
    memo:string | null;
        

    @Column("int",{ 
        nullable:true,
        name:"accountActionSeq"
        })
    accountActionSeq:number | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:12,
        name:"account"
        })
    account:string | null;
        

    @Column("varchar",{ 
        nullable:false,
        unique: true,
        length:32,
        name:"hash"
        })
    hash:string;
        

    @Column("int",{ 
        nullable:true,
        name:"auctionType"
        })
    auctionType:number | null;
        

    @Column("int",{ 
        nullable:true,
        name:"auctionId"
        })
    auctionId:number | null;
        

    @Column("int",{ 
        nullable:true,
        name:"bidId"
        })
    bidId:number | null;
        
}
