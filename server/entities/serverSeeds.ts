import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";


@Entity("serverSeeds",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("auctionId_UNIQUE",["auctionId",],{unique:true})
@Index("creationDatetime_idx",["creationDatetime",])
export class serverSeeds extends BaseEntity {

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
        name:"auctionId"
        })
    auctionId:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:36,
        name:"serverSeed"
        })
    serverSeed:string;
        

    @Column("varchar",{ 
        nullable:true,
        length:64,
        name:"clientSeed"
        })
    clientSeed:string | null;
        
}
