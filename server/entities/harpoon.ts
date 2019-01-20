import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";
import {auctions} from "./auctions";


@Entity("harpoon",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("auctionId_idx",["auctionId",])
@Index("creationDatetime_idx",["creationDatetime",])
@Index("accountName_idx",["accountName",])
@Index("status_idx",["status",])
export class harpoon extends BaseEntity {

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
        

    @Column("varchar",{ 
        nullable:false,
        length:15,
        name:"status"
        })
    status:string;
        

    @Column("int",{ 
        nullable:false,
        name:"auctionId"
        })
    auctionId:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:12,
        name:"accountName"
        })
    accountName:string;
        

    @Column("int",{ 
        nullable:false,
        name:"clientSeed"
        })
    clientSeed:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:36,
        name:"serverSeed"
        })
    serverSeed:string;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"odds"
        })
    odds:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:16,
        name:"result"
        })
    result:string;
        

   
    @OneToMany(type=>auctions, auctions=>auctions.harpoon_,{ onDelete: 'NO ACTION' ,onUpdate: 'NO ACTION' })
    auctionss:auctions[];
    
}
